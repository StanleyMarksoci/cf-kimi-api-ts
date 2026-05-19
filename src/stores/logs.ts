export interface RequestLog {
  id: string;
  timestamp: number;
  requestId: string;
  method: string;
  path: string;
  apiKeyName: string;
  model: string;
  status: string;
  statusCode: number;
  durationMs: number;
  isStream: boolean;
  errorMessage: string;
  upstreamStatusCode: number;
  upstreamErrorType: string;
  kimiAccountId: string;
  kimiAccountName: string;
  requestBody: string;
  responseBody: string;
  rawStreamBody: string;
}

export interface SearchLogsOptions {
  limit?: number;
  offset?: number;
  status?: string;
  model?: string;
  apiKeyName?: string;
  keyword?: string;
  path?: string;
  stream?: string;
}

export interface SearchLogsResult {
  logs: RequestLog[];
  total: number;
}

interface RequestLogRow {
  id: string;
  timestamp: number;
  request_id: string;
  method: string;
  path: string;
  api_key_name: string;
  model: string;
  status: string;
  status_code: number;
  duration_ms: number;
  is_stream: number;
  error_message: string;
  upstream_status_code: number;
  upstream_error_type: string;
  kimi_account_id: string;
  kimi_account_name: string;
  request_body: string;
  response_body: string;
  raw_stream_body: string;
}

function rowToLog(row: RequestLogRow): RequestLog {
  return {
    id: row.id,
    timestamp: row.timestamp,
    requestId: row.request_id,
    method: row.method,
    path: row.path,
    apiKeyName: row.api_key_name,
    model: row.model,
    status: row.status,
    statusCode: row.status_code,
    durationMs: row.duration_ms,
    isStream: row.is_stream === 1,
    errorMessage: row.error_message,
    upstreamStatusCode: row.upstream_status_code,
    upstreamErrorType: row.upstream_error_type,
    kimiAccountId: row.kimi_account_id,
    kimiAccountName: row.kimi_account_name,
    requestBody: row.request_body,
    responseBody: row.response_body,
    rawStreamBody: row.raw_stream_body,
  };
}

export async function initSchema(db: D1Database): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS request_logs (
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
    )
  `);
  await db.exec(
    "CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON request_logs(timestamp DESC)",
  );
  await db.exec(
    "CREATE INDEX IF NOT EXISTS idx_logs_status ON request_logs(status)",
  );
  await db.exec(
    "CREATE INDEX IF NOT EXISTS idx_logs_api_key ON request_logs(api_key_name)",
  );
}

export async function logRequest(
  db: D1Database,
  entry: RequestLog,
): Promise<void> {
  await db
    .prepare(
      `
      INSERT INTO request_logs (
        id, timestamp, request_id, method, path, api_key_name,
        model, status, status_code, duration_ms, is_stream, error_message,
        upstream_status_code, upstream_error_type, kimi_account_id, kimi_account_name,
        request_body, response_body, raw_stream_body
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .bind(
      entry.id,
      entry.timestamp,
      entry.requestId,
      entry.method,
      entry.path,
      entry.apiKeyName,
      entry.model,
      entry.status,
      entry.statusCode,
      entry.durationMs,
      entry.isStream ? 1 : 0,
      entry.errorMessage,
      entry.upstreamStatusCode,
      entry.upstreamErrorType,
      entry.kimiAccountId,
      entry.kimiAccountName,
      entry.requestBody,
      entry.responseBody,
      entry.rawStreamBody,
    )
    .run();
}

export async function searchLogs(
  db: D1Database,
  options: SearchLogsOptions = {},
): Promise<SearchLogsResult> {
  const where: string[] = [];
  const params: Array<string | number> = [];

  if (options.status) {
    where.push("status = ?");
    params.push(options.status);
  }
  if (options.model) {
    where.push("model = ?");
    params.push(options.model);
  }
  if (options.apiKeyName) {
    where.push("api_key_name = ?");
    params.push(options.apiKeyName);
  }
  if (options.path) {
    where.push("path LIKE ?");
    params.push(`%${options.path}%`);
  }
  if (options.stream === "1" || options.stream === "true") {
    where.push("is_stream = 1");
  } else if (options.stream === "0" || options.stream === "false") {
    where.push("is_stream = 0");
  }
  if (options.keyword) {
    where.push("(request_id LIKE ? OR path LIKE ? OR error_message LIKE ?)");
    const keyword = `%${options.keyword}%`;
    params.push(keyword, keyword, keyword);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(200, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);

  const logsStmt = db.prepare(`
    SELECT
      id, timestamp, request_id, method, path, api_key_name,
      model, status, status_code, duration_ms, is_stream, error_message,
      upstream_status_code, upstream_error_type, kimi_account_id, kimi_account_name,
      request_body, response_body, raw_stream_body
    FROM request_logs
    ${whereClause}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `);

  const logsResp = await logsStmt
    .bind(...params, limit, offset)
    .all<RequestLogRow>();
  const logs = (logsResp.results ?? []).map(rowToLog);

  const totalStmt = db.prepare(
    `SELECT COUNT(*) AS total FROM request_logs ${whereClause}`,
  );
  const totalResp = await totalStmt
    .bind(...params)
    .first<{ total: number | string }>();
  const totalRaw = totalResp?.total ?? 0;
  const total =
    typeof totalRaw === "string" ? Number.parseInt(totalRaw, 10) : totalRaw;

  return { logs, total: Number.isFinite(total) ? total : 0 };
}

export async function getLog(
  db: D1Database,
  id: string,
): Promise<RequestLog | null> {
  const row = await db
    .prepare(
      `
      SELECT
        id, timestamp, request_id, method, path, api_key_name,
        model, status, status_code, duration_ms, is_stream, error_message,
        upstream_status_code, upstream_error_type, kimi_account_id, kimi_account_name,
        request_body, response_body, raw_stream_body
      FROM request_logs
      WHERE id = ?
      LIMIT 1
    `,
    )
    .bind(id)
    .first<RequestLogRow>();

  return row ? rowToLog(row) : null;
}

export async function clearLogs(db: D1Database): Promise<void> {
  await db.exec("DELETE FROM request_logs");
}
