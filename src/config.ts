export interface Env {
  // Cloudflare bindings
  KV: KVNamespace
  DB: D1Database

  // App config
  KIMI_API_BASE: string
  DEFAULT_MODEL: string
  ADMIN_PASSWORD: string
  TIMEZONE: string
  REQUEST_LOG_RETENTION: string
  SESSION_SECRET: string
}

export function getConfig(env: Env) {
  return {
    kimiApiBase: (env.KIMI_API_BASE || 'https://www.kimi.com').replace(/\/+$/, ''),
    defaultModel: env.DEFAULT_MODEL || '',
    adminPassword: env.ADMIN_PASSWORD || '',
    timezone: env.TIMEZONE || 'Asia/Shanghai',
    requestLogRetention: Math.max(parseInt(env.REQUEST_LOG_RETENTION || '1000', 10), 1),
    sessionSecret: env.SESSION_SECRET || '',
  }
}
