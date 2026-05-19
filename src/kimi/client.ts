import {
  buildChatCompletion,
  contentChunk,
  reasoningChunk,
  roleChunk,
  stopChunk,
} from "./chunks";
import { extractDelta, iterGrpcEvents, updateContextFromEvent } from "./events";
import type { KimiModelSpec } from "./model-catalog";
import {
  ChatCompletion,
  ChatCompletionChunk,
  ConversationContext,
  KIMI_CHAT_PATH,
  KIMI_RESEARCH_USAGE_PATH,
  KIMI_SCENARIO,
  KIMI_SUBSCRIPTION_PATH,
  KimiAPIError,
  Message,
  createConversationContext,
  encodeConnectRequest,
  formatMessages,
  textContent,
} from "./protocol";
import { getConversation, saveConversation } from "../stores/conversations";
import {
  KimiTransport,
  buildKimiHeaders,
  classifyUpstreamStatus,
  getSharedTransport,
  loadOrCreateClientIdentity,
  processSessionId,
  retryAfterSeconds,
} from "./transport";

export type AccountUsageCallback = (account: {
  id: string;
  name: string;
}) => void;

export interface AccountRuntime {
  accountId: string;
  accountName: string;
  account: { id: string; name: string; deviceId: string };
  sessionId: string;
  tokenManager: {
    getAccessToken: () => Promise<string>;
    invalidateAndRetry?: () => Promise<void>;
  };
  transport: KimiTransport;
}

export interface AccountPool {
  configured: boolean;
  accountCount: () => number;
  acquire: (options?: { exclude?: Set<string> }) => Promise<AccountRuntime>;
  release?: (runtime: AccountRuntime, error?: unknown) => Promise<void> | void;
  recordFailure?: (runtime: AccountRuntime, error: unknown) => void;
  recordSuccess?: (runtime: AccountRuntime) => void;
}

export interface Kimi2APIOptions {
  timeout?: number;
  maxRetries?: number;
  baseUrl?: string;
  kv?: KVNamespace;
  accountPool?: AccountPool;
  tokenManager?: {
    getAccessToken: () => Promise<string>;
    invalidateAndRetry?: () => Promise<void>;
  };
  onAccountUsed?: AccountUsageCallback;
}

export class Kimi2API {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly onAccountUsed?: AccountUsageCallback;
  private readonly accountPool?: AccountPool;
  private readonly kv?: KVNamespace;
  private readonly legacyRuntime?: AccountRuntime;
  private readonly transport: KimiTransport;
  private readonly sessionId: string;

  lastAccountId = "";
  lastAccountName = "";

  constructor(options: Kimi2APIOptions = {}) {
    this.baseUrl = (options.baseUrl || "https://www.kimi.com").replace(
      /\/+$/,
      "",
    );
    this.timeout = options.timeout ?? 30;
    this.maxRetries = Math.max(options.maxRetries ?? 3, 1);
    this.onAccountUsed = options.onAccountUsed;
    this.accountPool = options.accountPool;
    this.kv = options.kv;

    const identity = loadOrCreateClientIdentity();
    this.sessionId = processSessionId();
    this.transport = getSharedTransport({
      baseUrl: this.baseUrl,
      timeout: this.timeout,
      maxRetries: this.maxRetries,
    });

    if (!this.accountPool?.configured && options.tokenManager) {
      this.legacyRuntime = {
        accountId: "",
        accountName: "",
        tokenManager: options.tokenManager,
        transport: this.transport,
        account: {
          id: "",
          name: "",
          deviceId: identity.deviceId,
        },
        sessionId: this.sessionId,
      };
    }
  }

  private notifyAccountUsed(runtime: AccountRuntime): void {
    this.lastAccountId = runtime.accountId;
    this.lastAccountName = runtime.accountName;
    if (this.onAccountUsed && runtime.accountId) {
      this.onAccountUsed({ id: runtime.accountId, name: runtime.accountName });
    }
  }

  private async withRuntime<T>(
    task: (runtime: AccountRuntime) => Promise<T>,
    exclude?: Set<string>,
  ): Promise<T> {
    if (this.accountPool?.configured) {
      const runtime = await this.accountPool.acquire({ exclude });
      this.notifyAccountUsed(runtime);
      try {
        const result = await task(runtime);
        this.accountPool.recordSuccess?.(runtime);
        return result;
      } catch (error) {
        this.accountPool.recordFailure?.(runtime, error);
        throw error;
      } finally {
        await this.accountPool.release?.(runtime);
      }
    }

    if (!this.legacyRuntime) {
      throw new KimiAPIError("Kimi token is not configured");
    }

    this.notifyAccountUsed(this.legacyRuntime);
    return task(this.legacyRuntime);
  }

  private async acquireRuntime(exclude?: Set<string>): Promise<{
    runtime: AccountRuntime;
    release: (error?: unknown) => Promise<void>;
  }> {
    if (this.accountPool?.configured) {
      const runtime = await this.accountPool.acquire({ exclude });
      this.notifyAccountUsed(runtime);
      return {
        runtime,
        release: async (error?: unknown) => {
          if (error) this.accountPool?.recordFailure?.(runtime, error);
          else this.accountPool?.recordSuccess?.(runtime);
          await this.accountPool?.release?.(runtime, error);
        },
      };
    }

    if (!this.legacyRuntime) {
      throw new KimiAPIError("Kimi token is not configured");
    }
    this.notifyAccountUsed(this.legacyRuntime);
    return {
      runtime: this.legacyRuntime,
      release: async () => undefined,
    };
  }

  private async getHeaders(
    runtime: AccountRuntime,
    extra?: Record<string, string>,
  ): Promise<Record<string, string>> {
    const token = await runtime.tokenManager.getAccessToken();
    return buildKimiHeaders({
      baseUrl: this.baseUrl,
      token,
      deviceId: runtime.account.deviceId,
      sessionId: runtime.sessionId,
      extra: {
        "Connect-Protocol-Version": "1",
        ...(extra || {}),
      },
    });
  }

  private buildChatPayload(options: {
    modelSpec: KimiModelSpec;
    messages: Message[];
    context: ConversationContext;
    enableWebSearch: boolean;
  }): Record<string, unknown> {
    const { context, messages, modelSpec, enableWebSearch } = options;

    const isContinuing = !!context.remoteChatId;
    const isSingleMessage = messages.length === 1;
    const lastMsg = messages[messages.length - 1];
    const content =
      isContinuing || isSingleMessage
        ? textContent(lastMsg).trim()
        : formatMessages(messages);
    if (!content) throw new Error("messages content must not be empty");

    const message: Record<string, unknown> = {
      role: "user",
      blocks: [{ message_id: "", text: { content } }],
      scenario: modelSpec.scenario,
    };
    if (context.lastAssistantMessageId)
      message.parent_id = context.lastAssistantMessageId;

    const payload: Record<string, unknown> = {
      scenario: modelSpec.scenario,
      tools: enableWebSearch ? [{ type: "TOOL_TYPE_SEARCH", search: {} }] : [],
      message,
      options: { thinking: modelSpec.thinking },
    };

    if (modelSpec.kimiPlusId) payload.kimiplusId = modelSpec.kimiPlusId;
    if (modelSpec.agentMode) payload.agentMode = modelSpec.agentMode;
    if (context.remoteChatId) payload.chat_id = context.remoteChatId;
    return payload;
  }

  private async raiseForResponse(response: Response): Promise<void> {
    if (response.status === 200) return;
    const body = (await response.text()).slice(0, 100);
    throw new KimiAPIError(
      `upstream error ${response.status}: ${body || "<empty>"}`,
      {
        retryAfter:
          response.status === 429
            ? retryAfterSeconds(response.headers)
            : undefined,
        upstreamStatusCode: response.status,
        upstreamErrorType: classifyUpstreamStatus(response.status),
      },
    );
  }

  async validateToken(): Promise<boolean> {
    try {
      const data = await this.getSubscription();
      return Boolean(data && data.subscription);
    } catch {
      return false;
    }
  }

  async getSubscription(): Promise<Record<string, unknown> | null> {
    try {
      return await this.withRuntime(async (runtime) => {
        const headers = await this.getHeaders(runtime);
        const response = await runtime.transport.request(
          "POST",
          KIMI_SUBSCRIPTION_PATH,
          {
            headers,
            body: JSON.stringify({}),
            timeout: 15,
          },
        );
        if (response.status !== 200) return null;
        return (await response.json()) as Record<string, unknown>;
      });
    } catch {
      return null;
    }
  }

  async getResearchUsage(): Promise<Record<string, unknown> | null> {
    try {
      return await this.withRuntime(async (runtime) => {
        const headers = await this.getHeaders(runtime);
        const response = await runtime.transport.request(
          "GET",
          KIMI_RESEARCH_USAGE_PATH,
          {
            headers,
            timeout: 15,
          },
        );
        if (response.status !== 200) return null;
        return (await response.json()) as Record<string, unknown>;
      });
    } catch {
      return null;
    }
  }

  private canSwitchAccount(error: unknown): boolean {
    if (!(error instanceof KimiAPIError)) return true;
    const statusCode = Number(error.upstreamStatusCode || 0);
    return (
      statusCode === 401 ||
      statusCode === 403 ||
      statusCode === 429 ||
      (statusCode >= 500 && statusCode <= 599) ||
      [
        "rate_limited",
        "server_error",
        "network_error",
        "stream_interrupted",
        "token_refresh_failed",
        "unauthorized",
        "forbidden",
      ].includes(error.upstreamErrorType)
    );
  }

  async syncChat(
    requestBody: Record<string, unknown>,
    model: string,
    context: ConversationContext,
  ): Promise<ChatCompletion> {
    const content = encodeConnectRequest(requestBody);
    const reasoningParts: string[] = [];
    const contentParts: string[] = [];
    const created = Math.floor(Date.now() / 1000);
    let currentPhase: "thinking" | "answer" | undefined;
    let lastError: unknown;

    const attemptedAccounts = new Set<string>();
    const poolCount = this.accountPool?.configured
      ? this.accountPool.accountCount()
      : 0;
    const attemptLimit = this.accountPool?.configured
      ? Math.max(this.maxRetries, poolCount)
      : this.maxRetries;

    for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
      reasoningParts.length = 0;
      contentParts.length = 0;
      currentPhase = undefined;
      let producedOutput = false;

      try {
        await this.withRuntime(async (runtime) => {
          if (runtime.accountId) attemptedAccounts.add(runtime.accountId);
          const headers = await this.getHeaders(runtime, {
            "Content-Type": "application/connect+json",
          });
          const response = await runtime.transport.request(
            "POST",
            KIMI_CHAT_PATH,
            {
              headers,
              body: content,
              timeout: this.timeout,
            },
          );
          await this.raiseForResponse(response);

          for await (const event of iterGrpcEvents(response, context)) {
            const delta = extractDelta(event, currentPhase);
            currentPhase = delta.phase;
            if (delta.reasoning_content) {
              producedOutput = true;
              reasoningParts.push(delta.reasoning_content);
            }
            if (delta.content) {
              producedOutput = true;
              contentParts.push(delta.content);
            }
            if ("done" in event) {
              producedOutput = true;
              break;
            }
          }
        }, attemptedAccounts);

        await this.persistContext(context);
        break;
      } catch (error) {
        lastError = error;
        if (
          producedOutput ||
          attempt === attemptLimit ||
          !this.canSwitchAccount(error)
        ) {
          if (error instanceof KimiAPIError) {
            throw new KimiAPIError(
              `chat completion failed after ${attempt} attempts: ${error.message}`,
              {
                retryAfter: error.retryAfter,
                upstreamStatusCode: error.upstreamStatusCode,
                upstreamErrorType: error.upstreamErrorType,
              },
            );
          }
          throw error;
        }
        await sleep(
          this.accountPool?.configured
            ? 0
            : Math.min(0.5 * attempt, 2.0) * 1000,
        );
      }
    }

    if (lastError && !contentParts.length && !reasoningParts.length) {
      if (lastError instanceof KimiAPIError) {
        throw new KimiAPIError(lastError.message, {
          retryAfter: lastError.retryAfter,
          upstreamStatusCode: lastError.upstreamStatusCode,
          upstreamErrorType: lastError.upstreamErrorType,
        });
      }
      throw new KimiAPIError(String(lastError));
    }

    const finalId = context.remoteChatId || context.requestConversationId;
    const result = buildChatCompletion({
      completionId: finalId,
      created,
      model,
      contentParts,
      reasoningParts,
    });

    return result;
  }

  async *streamChat(
    requestBody: Record<string, unknown>,
    model: string,
    context: ConversationContext,
  ): AsyncGenerator<ChatCompletionChunk> {
    const content = encodeConnectRequest(requestBody);
    const created = Math.floor(Date.now() / 1000);
    let sentRole = false;
    let sentStop = false;
    let currentPhase: "thinking" | "answer" | undefined;

    const attemptedAccounts = new Set<string>();
    const poolCount = this.accountPool?.configured
      ? this.accountPool.accountCount()
      : 0;
    const attemptLimit = this.accountPool?.configured
      ? Math.max(this.maxRetries, poolCount)
      : this.maxRetries;

    for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
      let release: ((error?: unknown) => Promise<void>) | undefined;
      try {
        const acquired = await this.acquireRuntime(attemptedAccounts);
        const runtime = acquired.runtime;
        release = acquired.release;

        if (runtime.accountId) attemptedAccounts.add(runtime.accountId);
        const headers = await this.getHeaders(runtime, {
          "Content-Type": "application/connect+json",
        });
        const response = await runtime.transport.request(
          "POST",
          KIMI_CHAT_PATH,
          {
            headers,
            body: content,
            timeout: this.timeout,
          },
        );
        await this.raiseForResponse(response);

        for await (const event of iterGrpcEvents(response, context)) {
          const chunkId = context.remoteChatId || context.requestConversationId;

          if (!sentRole) {
            sentRole = true;
            yield roleChunk({ chunkId, created, model });
          }

          const delta = extractDelta(event, currentPhase);
          currentPhase = delta.phase;

          if (delta.reasoning_content) {
            yield reasoningChunk({
              chunkId,
              created,
              model,
              reasoningContent: delta.reasoning_content,
            });
          }

          if (delta.content) {
            yield contentChunk({
              chunkId,
              created,
              model,
              content: delta.content,
            });
          }

          if ("done" in event) {
            sentStop = true;
            yield stopChunk({ chunkId, created, model });
            await this.persistContext(context);
            await release();
            return;
          }
        }

        await this.persistContext(context);
        await release();

        break;
      } catch (error) {
        if (release) await release(error);
        if (
          sentRole ||
          attempt === attemptLimit ||
          !this.canSwitchAccount(error)
        )
          throw error;
        await sleep(
          this.accountPool?.configured
            ? 0
            : Math.min(0.5 * attempt, 2.0) * 1000,
        );
      }
    }

    if (!sentStop) {
      const chunkId = context.remoteChatId || context.requestConversationId;
      yield stopChunk({ chunkId, created, model });
    }
  }

  async createRequestPayload(options: {
    modelSpec: KimiModelSpec;
    messages: Message[];
    conversationId?: string;
    enableWebSearch?: boolean;
  }): Promise<{
    payload: Record<string, unknown>;
    context: ConversationContext;
    conversationId: string;
  }> {
    const conversationId = options.conversationId || crypto.randomUUID();

    // 从 KV 读取旧上下文（跨请求持久化）
    let context: ConversationContext;
    if (this.kv) {
      const stored = await getConversation(this.kv, conversationId);
      if (stored) {
        context = {
          requestConversationId: conversationId,
          remoteChatId: stored.remoteChatId,
          lastAssistantMessageId: stored.lastAssistantMessageId,
          createdAt: stored.createdAt,
        };
      } else {
        context = createConversationContext(conversationId);
      }
    } else {
      context = createConversationContext(conversationId);
    }

    const payload = this.buildChatPayload({
      modelSpec: options.modelSpec || {
        id: "kimi-k2.6",
        displayName: "kimi-k2.6",
        scenario: KIMI_SCENARIO,
        thinking: false,
        supportsWebSearch: true,
        baseModelId: "kimi-k2.6",
        forceWebSearch: false,
        kimiPlusId: "",
        agentMode: "",
        description: "",
        inputPlaceholder: "",
      },
      messages: options.messages,
      context,
      enableWebSearch: Boolean(options.enableWebSearch),
    });

    return { payload, context, conversationId };
  }

  /** 把聊天上下文持久化到 KV，供后续请求续对话 */
  async persistContext(context: ConversationContext): Promise<void> {
    if (!this.kv || !context.remoteChatId) return;
    await saveConversation(this.kv, context.requestConversationId, {
      remoteChatId: context.remoteChatId,
      lastAssistantMessageId: context.lastAssistantMessageId || "",
      createdAt: context.createdAt,
    });
  }

  updateContextFromEvent(
    context: ConversationContext,
    event: Record<string, any>,
  ): void {
    updateContextFromEvent(context, event);
  }

  async close(): Promise<void> {
    return;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(ms, 0)));
}
