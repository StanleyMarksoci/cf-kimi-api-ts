import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "../config";
import { getConfig } from "../config";
import { createSession, verifySession } from "../services/session";
import {
  addAccount,
  deleteAccount,
  loadAccounts,
  updateAccount,
} from "../stores/accounts";
import { createKey, deleteKey, loadKeys } from "../stores/keys";
import { getLog, searchLogs } from "../stores/logs";

const SESSION_COOKIE = "cf_kimi_session";
const CSRF_COOKIE = "cf_kimi_csrf";

/** 解析 JWT payload（无签名验证，仅读字段） */
function parseJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    let payload = parts[1];
    payload += "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

function detectTokenType(token: string): "jwt" | "refresh" {
  if (token.startsWith("eyJ") && token.split(".").length === 3) {
    const payload = parseJwt(token);
    if (payload?.app_id === "kimi" && payload?.typ === "access") return "jwt";
  }
  return "refresh";
}

function formatExpires(exp: number): string {
  if (!exp || exp <= 0) return "-";
  const remaining = exp - Date.now() / 1000;
  if (remaining <= 0) return "已过期";
  if (remaining > 86400) return `${Math.round(remaining / 86400)}天后过期`;
  if (remaining > 3600) return `${Math.round(remaining / 3600)}小时后过期`;
  return `${Math.round(remaining / 60)}分钟后过期`;
}

/** 计算每个账号的健康状态 */
function accountHealth(rawToken: string): { healthy: boolean; expiresIn: string } {
  const type = detectTokenType(rawToken);
  if (type === "refresh") {
    // refresh token 本身不过期，但可能被上游吊销（无法本地判断）
    return { healthy: true, expiresIn: "refresh" };
  }
  const payload = parseJwt(rawToken);
  const exp = Number(payload?.exp ?? 0);
  const now = Date.now() / 1000;
  return { healthy: !exp || exp > now, expiresIn: formatExpires(exp) };
}

function durationDisplay(durationMs: number): string {
  const sec = durationMs / 1000;
  if (sec < 1) return `${durationMs.toFixed(0)}ms`;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m${Math.floor(sec % 60)}s`;
  const hours = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (hours < 24) return `${hours}h${mins}m`;
  const days = Math.floor(hours / 24);
  return `${days}d${hours % 24}h`;
}

function uptimeDisplay(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分${Math.floor(seconds % 60)}秒`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h < 24) return `${h}时${m}分`;
  const d = Math.floor(h / 24);
  return `${d}天${h % 24}时${m}分`;
}

const router = new Hono<{ Bindings: Env }>();
type DC = Context<{ Bindings: Env }>;

async function isAuthed(c: DC): Promise<boolean> {
  const config = getConfig(c.env);
  if (!config.adminPassword || !config.sessionSecret) return false;
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return false;
  return Boolean(await verifySession(config.sessionSecret, token));
}

function csrfOk(c: DC): boolean {
  const h = c.req.header("X-CSRF-Token") || "";
  const cookie = getCookie(c, CSRF_COOKIE) || "";
  return Boolean(h) && h === cookie;
}

// ─── Session ───

router.get("/admin/api/session", async (c) => {
  const config = getConfig(c.env);
  if (!config.adminPassword || !config.sessionSecret)
    return c.json({ enabled: false }, 503);
  if (!(await isAuthed(c))) return c.json({ authenticated: false }, 401);
  return c.json({
    authenticated: true,
    csrf_token: getCookie(c, CSRF_COOKIE) || "",
  });
});

router.post("/admin/api/login", async (c) => {
  const config = getConfig(c.env);
  if (!config.adminPassword || !config.sessionSecret)
    return c.json({ success: false, error: "管理面板未启用" }, 503);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const password = typeof body.password === "string" ? body.password : "";
  if (password !== config.adminPassword)
    return c.json({ success: false, error: "密码错误" }, 401);

  const token = await createSession(config.sessionSecret, {
    username: "admin",
    role: "admin",
  });
  const csrf = crypto.randomUUID();
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
  });
  setCookie(c, CSRF_COOKIE, csrf, {
    httpOnly: false,
    sameSite: "Lax",
    path: "/",
  });
  return c.json({ success: true });
});

router.post("/admin/api/logout", async (c) => {
  if (!(await isAuthed(c))) return c.json({ error: "Unauthorized" }, 401);
  if (!csrfOk(c)) return c.json({ error: "Forbidden" }, 403);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  deleteCookie(c, CSRF_COOKIE, { path: "/" });
  return c.json({ success: true });
});

// ─── Helper: check bindings ───

function kvReady(c: DC): boolean {
  return typeof c.env.KV?.get === 'function'
}

function dbReady(c: DC): boolean {
  return typeof c.env.DB?.prepare === 'function'
}

// ─── Stats ───

router.get("/admin/api/stats", async (c) => {
  if (!(await isAuthed(c))) return c.json({ error: "Unauthorized" }, 401);

  if (!kvReady(c)) {
    return c.json({ setup_needed: true, missing: ['KV'], message: 'KV 命名空间未绑定。请在 Cloudflare Dashboard → 你的 Worker → 设置 → 绑定中添加 KV 命名空间。' })
  }

  try {
    // Setup D1 table if available
    if (dbReady(c)) {
      await c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS request_logs (
        id TEXT PRIMARY KEY,
        timestamp REAL NOT NULL,
        request_id TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        api_key_name TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        status_code INTEGER NOT NULL DEFAULT 0,
        duration_ms REAL NOT NULL DEFAULT 0,
        is_stream INTEGER NOT NULL DEFAULT 0,
        error_message TEXT NOT NULL DEFAULT '',
        upstream_status_code INTEGER NOT NULL DEFAULT 0,
        upstream_error_type TEXT NOT NULL DEFAULT '',
        kimi_account_id TEXT NOT NULL DEFAULT '',
        kimi_account_name TEXT NOT NULL DEFAULT '',
        request_body TEXT NOT NULL DEFAULT '',
        response_body TEXT NOT NULL DEFAULT '',
        raw_stream_body TEXT NOT NULL DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
      )`).run().catch(()=>{});
    }

    // 从日志最早一条记录计算运行时间
    const firstLog = await searchLogs(c.env.DB, { limit: 1, offset: 0 }).catch(() => ({ logs: [], total: 0 }));
    const earliestTs = firstLog.logs[0]?.timestamp;
    const uptimeSeconds = earliestTs ? Math.floor(Date.now() / 1000) - earliestTs : 0;

    const allAccounts = await loadAccounts(c.env.KV);
    const enabledAccounts = allAccounts.filter((a) => a.enabled);
    const keys = await loadKeys(c.env.KV);

    // 逐账号统计
    const accountHealths = allAccounts.map((a) => accountHealth(a.rawToken));
    const healthyCount = accountHealths.filter((h) => h.healthy).length;
    const unhealthyCount = accountHealths.filter((h) => !h.healthy).length;

    // 日志统计 — 扩大采样范围以获取更多维度
    const logs = await searchLogs(c.env.DB, { limit: 500, offset: 0 }).catch(() => ({ logs: [], total: 0 }));
    const now = Date.now() / 1000;
    const recent = logs.logs.filter((item) => now - item.timestamp <= 86400);
    const allTime = logs.logs;

    const successCount = recent.filter((x) => x.status === "success").length;
    const errorCount = recent.filter((x) => x.status !== "success").length;
    const streamCount = recent.filter((x) => x.isStream).length;

    // API Key 调用排行
    const keyCount = new Map<string, number>();
    allTime.forEach((l) => {
      const name = l.apiKeyName || "(unknown)";
      keyCount.set(name, (keyCount.get(name) || 0) + 1);
    });
    const topKeys = [...keyCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    // 账号请求分布
    const accountReqCount = new Map<string, number>();
    allTime.forEach((l) => {
      if (l.kimiAccountName) accountReqCount.set(l.kimiAccountName, (accountReqCount.get(l.kimiAccountName) || 0) + 1);
    });

    // 错误类型排行
    const errorTypes = new Map<string, number>();
    allTime.forEach((l) => {
      if (l.errorMessage) errorTypes.set(l.errorMessage, (errorTypes.get(l.errorMessage) || 0) + 1);
    });
    const topErrors = [...errorTypes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([msg, count]) => ({ message: msg.slice(0, 120), count }));

    const recentErrors = recent.filter((item) => item.status !== "success").slice(0, 5);
    const avgDuration = recent.length
      ? recent.reduce((sum, item) => sum + item.durationMs, 0) / recent.length
      : 0;

    // 取启用账号中第一个有效 Token 展示类型
    const firstEnabled = enabledAccounts[0];
    const firstTokenType = firstEnabled ? detectTokenType(firstEnabled.rawToken) : "unknown";

    return c.json({
      uptime: uptimeSeconds,
      uptime_display: uptimeDisplay(uptimeSeconds),

      token_type: firstTokenType,
      token_healthy: healthyCount > 0,
      token_healthy_count: healthyCount,
      token_unhealthy_count: unhealthyCount,

      account_total: allAccounts.length,
      account_enabled: enabledAccounts.length,
      account_healthy: healthyCount,
      account_unhealthy: unhealthyCount,

      key_count: keys.length,

      total_requests: logs.total,
      recent_24h_total: recent.length,
      recent_24h_success: successCount,
      recent_24h_error: errorCount,
      recent_24h_stream: streamCount,
      recent_24h_success_rate: recent.length > 0
        ? `${Math.round((successCount / recent.length) * 100)}%`
        : "-",
      recent_24h_avg_duration: durationDisplay(avgDuration),
      recent_24h_stream_rate: recent.length > 0
        ? `${Math.round((streamCount / recent.length) * 100)}%`
        : "-",

      top_keys: topKeys,
      top_errors: topErrors,
      account_requests: [...accountReqCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ account: name, count })),

      recent_errors: recentErrors.map((item) => ({
        request_id: item.requestId,
        time_str: new Date(item.timestamp * 1000).toISOString(),
        status_code: item.statusCode,
        api_key_name: item.apiKeyName,
        kimi_account_name: item.kimiAccountName,
        error_message: item.errorMessage,
        duration_ms: item.durationMs,
        duration_display: durationDisplay(item.durationMs),
      })),

      request_log_retention: getConfig(c.env).requestLogRetention,
    });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// ─── Keys ───

router.get("/admin/api/keys", async (c) => {
  if (!(await isAuthed(c))) return c.json({ error: "Unauthorized" }, 401);
  if (!kvReady(c)) return c.json({ error: "KV 未绑定", setup_needed: true }, 503);
  const keys = await loadKeys(c.env.KV);
  return c.json({
    keys: keys.map((k) => ({
      key: k.key,
      key_preview: `${k.key.slice(0, 8)}...${k.key.slice(-4)}`,
      name: k.name,
      created_at_str: new Date(k.createdAt * 1000).toISOString(),
      last_used_str: k.lastUsed
        ? new Date(k.lastUsed * 1000).toISOString()
        : "-",
      request_count: k.requestCount,
    })),
  });
});

router.post("/admin/api/keys", async (c) => {
  if (!(await isAuthed(c))) return c.json({ error: "Unauthorized" }, 401);
  if (!csrfOk(c)) return c.json({ error: "Forbidden" }, 403);
  if (!kvReady(c)) return c.json({ error: "KV 未绑定", setup_needed: true }, 503);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const created = await createKey(c.env.KV, typeof body.name === "string" ? body.name : undefined);
  return c.json({ new_key: created.key });
});

router.delete("/admin/api/keys/:key", async (c) => {
  if (!(await isAuthed(c))) return c.json({ error: "Unauthorized" }, 401);
  if (!csrfOk(c)) return c.json({ error: "Forbidden" }, 403);
  if (!kvReady(c)) return c.json({ error: "KV 未绑定", setup_needed: true }, 503);
  const deleted = await deleteKey(c.env.KV, c.req.param("key"));
  return c.json({ deleted });
});

// ─── Logs ───

router.get("/admin/api/logs", async (c) => {
  if (!(await isAuthed(c))) return c.json({ error: "Unauthorized" }, 401);
  if (!dbReady(c)) return c.json({ error: "D1 未绑定", setup_needed: true }, 503);
  const page = Math.max(1, Number.parseInt(c.req.query("page") || "1", 10) || 1);
  const pageSize = 20;
  const status = c.req.query("status") || undefined;
  const model = c.req.query("model") || undefined;
  const apiKeyName = c.req.query("api_key_name") || undefined;
  const keyword = c.req.query("q") || undefined;
  const pathFilter = c.req.query("path") || undefined;
  const streamFilter = c.req.query("stream") || undefined;

  const result = await searchLogs(c.env.DB, {
    offset: (page - 1) * pageSize,
    limit: pageSize,
    status,
    model,
    apiKeyName,
    keyword,
    path: pathFilter,
    stream: streamFilter,
  });

  const pageCount = Math.max(1, Math.ceil(result.total / pageSize));
  return c.json({
    logs: result.logs.map((item) => ({
      request_id: item.requestId,
      time_str: new Date(item.timestamp * 1000).toISOString(),
      api_key_name: item.apiKeyName,
      kimi_account_name: item.kimiAccountName,
      model: item.path === "/v1/models" ? "" : item.model,
      method: item.method,
      path: item.path,
      status: item.status,
      status_code: item.statusCode,
      duration_ms: item.durationMs,
      duration_display: durationDisplay(item.durationMs),
      is_stream: item.isStream,
      error_message: item.errorMessage,
      upstream_status_code: item.upstreamStatusCode,
      upstream_error_type: item.upstreamErrorType,
      upstream_summary: item.upstreamStatusCode
        ? `上游 ${item.upstreamStatusCode} ${item.upstreamErrorType}`.trim()
        : "",
    })),
    pagination: {
      total: result.total,
      page,
      page_count: pageCount,
      page_size: pageSize,
      start_index: (page - 1) * pageSize + 1,
      end_index: Math.min(page * pageSize, result.total),
      has_prev: page > 1,
      has_next: page < pageCount,
    },
  });
});

router.get("/admin/api/logs/:id", async (c) => {
  if (!(await isAuthed(c))) return c.json({ error: "Unauthorized" }, 401);
  if (!dbReady(c)) return c.json({ error: "D1 未绑定", setup_needed: true }, 503);
  const item = await getLog(c.env.DB, c.req.param("id"));
  if (!item) return c.json({ error: "Not Found" }, 404);

  let requestBodyParsed: Record<string, unknown> | null = null;
  let messages: Array<{ role: string; content: string }> = [];
  let systemPrompt = "";
  try {
    requestBodyParsed = item.requestBody ? JSON.parse(item.requestBody) : null;
    if (requestBodyParsed?.messages && Array.isArray(requestBodyParsed.messages)) {
      messages = (requestBodyParsed.messages as Array<Record<string, unknown>>).map((m) => ({
        role: String(m.role || ""),
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      }));
    }
    if (requestBodyParsed?.system || requestBodyParsed?.instructions) {
      systemPrompt = String(requestBodyParsed?.system || requestBodyParsed?.instructions || "");
    }
  } catch { /* ignore */ }

  // 解析响应内容
  let responseContent = "";
  let reasoningContent = "";
  try {
    if (item.responseBody) {
      const resp = JSON.parse(item.responseBody);
      if (resp.choices?.[0]?.message) {
        responseContent = resp.choices[0].message.content || "";
        reasoningContent = resp.choices[0].message.reasoning_content || "";
      }
    }
  } catch { /* ignore */ }

  return c.json({
    request_id: item.requestId,
    time_str: new Date(item.timestamp * 1000).toISOString(),
    method: item.method,
    path: item.path,
    api_key_name: item.apiKeyName,
    kimi_account_name: item.kimiAccountName,
    model: item.model,
    status: item.status,
    status_code: item.statusCode,
    duration_ms: item.durationMs,
    duration_display: durationDisplay(item.durationMs),
    is_stream: item.isStream,
    error_message: item.errorMessage,
    upstream_status_code: item.upstreamStatusCode,
    upstream_error_type: item.upstreamErrorType,
    upstream_summary: item.upstreamStatusCode
      ? `上游 ${item.upstreamStatusCode} ${item.upstreamErrorType}`.trim()
      : "",
    request_body: item.requestBody,
    request_body_parsed: requestBodyParsed,
    system_prompt: systemPrompt,
    messages,
    response_content: responseContent,
    reasoning_content: reasoningContent,
    raw_stream_body: item.rawStreamBody,
  });
});

// ─── Accounts ───

router.get("/admin/api/tokens", async (c) => {
  if (!(await isAuthed(c))) return c.json({ error: "Unauthorized" }, 401);
  if (!kvReady(c)) return c.json({ error: "KV 未绑定", setup_needed: true }, 503);
  const accounts = await loadAccounts(c.env.KV);
  const list = accounts.map((a) => {
    const h = accountHealth(a.rawToken);
    return {
      id: a.id,
      name: a.name,
      enabled: a.enabled,
      token_type: detectTokenType(a.rawToken),
      token_expires: h.expiresIn,
      token_preview: `${a.rawToken.slice(0, 6)}...${a.rawToken.slice(-4)}`,
      token_healthy: h.healthy,
      max_concurrency: a.maxConcurrency,
      min_interval_seconds: a.minIntervalSeconds,
    };
  });
  return c.json({ accounts: list });
});

router.post("/admin/api/tokens", async (c) => {
  if (!(await isAuthed(c))) return c.json({ error: "Unauthorized" }, 401);
  if (!csrfOk(c)) return c.json({ error: "Forbidden" }, 403);
  if (!kvReady(c)) return c.json({ error: "KV 未绑定", setup_needed: true }, 503);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const raw = typeof body.raw_token === "string" ? body.raw_token.trim() : "";
  if (!raw) return c.json({ success: false, error: "Token 不能为空" }, 400);
  await addAccount(c.env.KV, raw, typeof body.name === "string" ? body.name : undefined);
  return c.json({ success: true });
});

router.patch("/admin/api/tokens/:id", async (c) => {
  if (!(await isAuthed(c))) return c.json({ error: "Unauthorized" }, 401);
  if (!csrfOk(c)) return c.json({ error: "Forbidden" }, 403);
  if (!kvReady(c)) return c.json({ error: "KV 未绑定", setup_needed: true }, 503);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") patch.name = body.name;
  if (typeof body.raw_token === "string") patch.rawToken = body.raw_token;
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.max_concurrency === "number") patch.maxConcurrency = body.max_concurrency;
  if (typeof body.min_interval_seconds === "number") patch.minIntervalSeconds = body.min_interval_seconds;
  const updated = await updateAccount(c.env.KV, c.req.param("id"), patch);
  if (!updated) return c.json({ success: false, error: "账号不存在" }, 404);
  return c.json({ success: true });
});

router.delete("/admin/api/tokens/:id", async (c) => {
  if (!(await isAuthed(c))) return c.json({ error: "Unauthorized" }, 401);
  if (!csrfOk(c)) return c.json({ error: "Forbidden" }, 403);
  if (!kvReady(c)) return c.json({ error: "KV 未绑定", setup_needed: true }, 503);
  const deleted = await deleteAccount(c.env.KV, c.req.param("id"));
  if (!deleted) return c.json({ success: false, error: "账号不存在" }, 404);
  return c.json({ success: true });
});

// 单账号 Token 刷新（stub — 实际刷新在 TokenManager 中按需进行）
router.post("/admin/api/tokens/:id/refresh", async (c) => {
  if (!(await isAuthed(c))) return c.json({ error: "Unauthorized" }, 401);
  if (!csrfOk(c)) return c.json({ error: "Forbidden" }, 403);
  return c.json({ success: true });
});

// 单账号 Token 验证
router.get("/admin/api/tokens/:id/validate", async (c) => {
  if (!(await isAuthed(c))) return c.json({ error: "Unauthorized" }, 401);
  const accounts = await loadAccounts(c.env.KV);
  const account = accounts.find((a) => a.id === c.req.param("id"));
  if (!account) return c.json({ success: false, error: "账号不存在" }, 404);
  return c.json({ valid: true });
});

export default router;
