import { Hono } from "hono";
import type { Env } from "../config";
import { getConfig } from "../config";
import { Kimi2API } from "../kimi/client";
import { KimiAPIError, type Message } from "../kimi/protocol";
import { getModelCatalog } from "../kimi/model-catalog";
import { AccountPool } from "../services/account-pool";
import { loadAccounts } from "../stores/accounts";
import { logRequest, type RequestLog } from "../stores/logs";
import { verifyApiKey, type ApiAuthVariables } from "./auth";
import { jsonError } from "./errors";
import { modelToDict, ModelResolutionError, resolveModel } from "./models";
import { createStreamingResponse, streamChatChunks } from "./streaming";

interface ApiVariables extends ApiAuthVariables {
  requestModel: string;
  kimiAccountId: string;
  kimiAccountName: string;
}

const FIRST_API_CALL_KEY = "meta:first_api_call";

const router = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

/** 记录首次 API 调用时间 */
async function recordFirstCall(kv: KVNamespace): Promise<void> {
  const existing = await kv.get(FIRST_API_CALL_KEY);
  if (!existing) {
    await kv.put(FIRST_API_CALL_KEY, String(Math.floor(Date.now() / 1000)));
  }
}

function normalizeMessages(input: unknown): Message[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object",
    )
    .map((item) => ({
      role: typeof item.role === "string" ? item.role : "user",
      content: item.content ?? "",
      name: typeof item.name === "string" ? item.name : undefined,
      tool_call_id:
        typeof item.tool_call_id === "string" ? item.tool_call_id : undefined,
      tool_calls: Array.isArray(item.tool_calls) ? item.tool_calls : undefined,
    }));
}

function requestId(): string {
  return crypto.randomUUID();
}

function emptyLog(
  id: string,
  method: string,
  path: string,
  keyName: string,
): RequestLog {
  return {
    id,
    timestamp: Date.now() / 1000,
    requestId: id,
    method,
    path,
    apiKeyName: keyName,
    model: "",
    status: "error",
    statusCode: 500,
    durationMs: 0,
    isStream: false,
    errorMessage: "",
    upstreamStatusCode: 0,
    upstreamErrorType: "",
    kimiAccountId: "",
    kimiAccountName: "",
    requestBody: "",
    responseBody: "",
    rawStreamBody: "",
  };
}

router.get("/v1/models", verifyApiKey, async (c) => {
  const now = Math.floor(Date.now() / 1000);
  const catalog = await getModelCatalog(c.env.KV, c.env.KIMI_API_BASE);
  return c.json({
    object: "list",
    data: catalog.models.map((m) => modelToDict(m, now)),
  });
});

router.get("/v1/models/:id", verifyApiKey, async (c) => {
  const modelId = c.req.param("id");
  const now = Math.floor(Date.now() / 1000);
  const catalog = await getModelCatalog(c.env.KV, c.env.KIMI_API_BASE);
  const model = catalog.models.find((m) => m.id === modelId);
  if (!model)
    return jsonError(
      `Model \`${modelId}\` is not available`,
      "invalid_request_error",
      400,
    );
  return c.json(modelToDict(model, now));
});

router.post("/v1/chat/completions", verifyApiKey, async (c) => {
  const startedAt = Date.now();
  const rid = requestId();
  const apiKey = c.get("apiKey");
  c.executionCtx.waitUntil(recordFirstCall(c.env.KV));
  const baseLog = emptyLog(rid, "POST", "/v1/chat/completions", apiKey.name);

  try {
    const payload = (await c.req.json()) as Record<string, unknown>;
    baseLog.requestBody = JSON.stringify(payload);
    const messages = normalizeMessages(payload.messages);
    if (!messages.length)
      return jsonError("`messages` is required", "invalid_request_error", 400);

    const catalog = await getModelCatalog(c.env.KV, c.env.KIMI_API_BASE);
    const config = getConfig(c.env);
    const features = resolveModel(payload, catalog, config.defaultModel);
    c.set("requestModel", features.requestModel);

    const accounts = (await loadAccounts(c.env.KV)).filter(
      (item) => item.enabled && item.rawToken.trim(),
    );

    if (!accounts.length)
      return jsonError("No available Kimi accounts", "api_error", 503);

    const client = new Kimi2API({
      baseUrl: c.env.KIMI_API_BASE,
      kv: c.env.KV,
      accountPool: new AccountPool(accounts, {
        kv: c.env.KV,
        baseUrl: c.env.KIMI_API_BASE,
      }),
      onAccountUsed: (account) => {
        c.set("kimiAccountId", account.id);
        c.set("kimiAccountName", account.name);
      },
    });

    const conversationId =
      typeof payload.conversation_id === "string"
        ? payload.conversation_id
        : undefined;
    const created = await client.createRequestPayload({
      modelSpec: features.modelSpec,
      messages,
      conversationId,
      enableWebSearch: features.enableWebSearch,
    });

    if (payload.stream === true) {
      const stream = client.streamChat(
        created.payload,
        features.model,
        created.context,
      );
      const res = createStreamingResponse(() =>
        streamChatChunks(stream, features.requestModel, created.conversationId),
      );
      c.executionCtx.waitUntil(
        logRequest(c.env.DB, {
          ...baseLog,
          model: features.requestModel,
          status: "success",
          statusCode: 200,
          isStream: true,
          durationMs: Date.now() - startedAt,
          kimiAccountId: c.get("kimiAccountId") || "",
          kimiAccountName: c.get("kimiAccountName") || "",
        }),
      );
      return res;
    }

    const result = await client.syncChat(
      created.payload,
      features.model,
      created.context,
    );
    result.model = features.requestModel;
    (result as any).conversation_id = created.conversationId;

    const body = JSON.stringify(result);
    c.executionCtx.waitUntil(
      logRequest(c.env.DB, {
        ...baseLog,
        model: features.requestModel,
        status: "success",
        statusCode: 200,
        durationMs: Date.now() - startedAt,
        responseBody: body,
        kimiAccountId: c.get("kimiAccountId") || "",
        kimiAccountName: c.get("kimiAccountName") || "",
      }),
    );

    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    // 如果是在解析 payload 之后出错，已有 requestBody；否则尝试读取
    if (!baseLog.requestBody) {
      try { baseLog.requestBody = JSON.stringify(await c.req.json()); } catch {}
    }
    const status =
      error instanceof ModelResolutionError
        ? 400
        : error instanceof KimiAPIError
          ? 502
          : 500;
    const type =
      error instanceof ModelResolutionError
        ? "invalid_request_error"
        : "api_error";
    const message = error instanceof Error ? error.message : "Request failed";

    c.executionCtx.waitUntil(
      logRequest(c.env.DB, {
        ...baseLog,
        model: c.get("requestModel") || "",
        status: "error",
        statusCode: status,
        durationMs: Date.now() - startedAt,
        errorMessage: message,
        upstreamStatusCode:
          error instanceof KimiAPIError ? error.upstreamStatusCode : 0,
        upstreamErrorType:
          error instanceof KimiAPIError ? error.upstreamErrorType : "",
        kimiAccountId: c.get("kimiAccountId") || "",
        kimiAccountName: c.get("kimiAccountName") || "",
      }),
    );

    const res = jsonError(message, type, status);
    if (error instanceof KimiAPIError) {
      res.headers.set(
        "X-Kimi-Upstream-Status",
        String(error.upstreamStatusCode || 0),
      );
      res.headers.set(
        "X-Kimi-Upstream-Error-Type",
        error.upstreamErrorType || "",
      );
      if (error.retryAfter)
        res.headers.set(
          "X-Kimi-Upstream-Retry-After",
          String(error.retryAfter),
        );
    }
    return res;
  }
});

router.all("/v1/*", () =>
  jsonError("Endpoint not supported", "invalid_request_error", 404),
);

export default router;
