export const KIMI_CHAT_PATH = "/apiv2/kimi.gateway.chat.v1.ChatService/Chat";
export const KIMI_SUBSCRIPTION_PATH =
  "/apiv2/kimi.gateway.order.v1.SubscriptionService/GetSubscription";
export const KIMI_RESEARCH_USAGE_PATH = "/api/chat/research/usage";
export const KIMI_SCENARIO = "SCENARIO_K2D5";
export const THINKING_STAGE_NAME = "STAGE_NAME_THINKING";

export const FAKE_HEADERS: Record<string, string> = {
  Accept: "*/*",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  Origin: "https://www.kimi.com",
  "R-Timezone": "Asia/Shanghai",
  "Sec-Ch-Ua":
    '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Priority: "u=1, i",
  "X-Msh-Platform": "web",
};

export class KimiAPIError extends Error {
  retryAfter?: number;
  upstreamStatusCode: number;
  upstreamErrorType: string;

  constructor(
    message: string,
    options?: {
      retryAfter?: number;
      upstreamStatusCode?: number;
      upstreamErrorType?: string;
    },
  ) {
    super(message);
    this.name = "KimiAPIError";
    this.retryAfter = options?.retryAfter;
    this.upstreamStatusCode = Number(options?.upstreamStatusCode || 0);
    this.upstreamErrorType = options?.upstreamErrorType || "";
  }
}

export interface Message {
  role: string;
  content: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<Record<string, unknown>>;
}

export interface ChatCompletionMessage {
  role: string;
  content: string | null;
  reasoning_content?: string | null;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatCompletionMessage;
  finish_reason: string;
}

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletion {
  id: string;
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: ChatCompletionUsage;
  object: "chat.completion";
}

export interface ChatCompletionChunk {
  id: string;
  created: number;
  model: string;
  choices: Array<Record<string, unknown>>;
  object: "chat.completion.chunk";
}

export interface ConversationContext {
  requestConversationId: string;
  remoteChatId?: string;
  lastAssistantMessageId?: string;
  createdAt: number;
}

export function createConversationContext(
  requestConversationId: string,
): ConversationContext {
  return {
    requestConversationId,
    createdAt: Date.now() / 1000,
  };
}

export function generateDeviceId(): string {
  return String(
    Math.floor(7000000000000000000 + Math.random() * 1000000000000000000),
  );
}

export function generateSessionId(): string {
  return String(
    Math.floor(1700000000000000000 + Math.random() * 1000000000000000000),
  );
}

export function parseJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    let payload = parts[1];
    payload += "=".repeat((4 - (payload.length % 4)) % 4);
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(normalized)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function detectTokenType(token: string): "jwt" | "refresh" {
  if (token.startsWith("eyJ") && token.split(".").length === 3) {
    const payload = parseJwt(token);
    if (payload?.app_id === "kimi" && payload?.typ === "access") {
      return "jwt";
    }
  }
  return "refresh";
}

export function textContent(message: Message): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (typeof item === "string") {
        parts.push(item);
      } else if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        if (rec.type === "text") parts.push(String(rec.text ?? ""));
        else if ("text" in rec) parts.push(String(rec.text ?? ""));
      }
    }
    return parts.filter(Boolean).join("\n");
  }
  if (content == null) return "";
  return String(content);
}

function wrapUrls(text: string): string {
  return text;
}

export function formatMessages(messages: Message[]): string {
  const systemLines: string[] = [];
  const bodyLines: string[] = [];

  for (const message of messages) {
    let role = message.role;
    let text = textContent(message).trim();

    if (role === "assistant" && message.tool_calls?.length) {
      const toolCallsText = message.tool_calls
        .map((call) => {
          const fn =
            (call.function as Record<string, unknown> | undefined) || {};
          return `[call:${String(fn.name ?? "")}]${String(fn.arguments ?? "")}[/call]`;
        })
        .join("\n")
        .trim();
      if (toolCallsText)
        text = `[function_calls]\n${toolCallsText}\n[/function_calls]`;
    }

    if (role === "tool" && message.tool_call_id) {
      role = "user";
      text = `[TOOL_RESULT for ${message.tool_call_id}] ${text}`.trim();
    }

    if (!text) continue;

    if (role === "system") {
      systemLines.push(text);
      continue;
    }

    if (role === "user") text = wrapUrls(text);
    bodyLines.push(`${role}:${text}`);
  }

  return [...systemLines.map((line) => `system:${line}`), ...bodyLines]
    .join("\n")
    .trim();
}

export function encodeConnectRequest(
  payload: Record<string, unknown>,
): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const header = new Uint8Array(5);
  header[0] = 0x00;
  new DataView(header.buffer).setUint32(1, body.length, false);
  const result = new Uint8Array(5 + body.length);
  result.set(header, 0);
  result.set(body, 5);
  return result;
}
