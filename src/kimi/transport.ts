import { FAKE_HEADERS, generateDeviceId, generateSessionId } from './protocol'

export const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504]

export interface FetchOptions extends Omit<RequestInit, 'method'> {
  timeout?: number
  retryableStatusCodes?: number[]
}

export interface TransportOptions {
  baseUrl?: string
  timeout?: number
  maxRetries?: number
  rateLimiter?: RateLimiter
}

export interface KimiClientIdentity {
  deviceId: string
  createdAt: number
}

export class RateLimiter {
  private active = 0
  private lastRequestAt = 0

  constructor(
    private readonly maxConcurrency: number = 1,
    private readonly minIntervalSeconds: number = 0,
  ) {}

  async withSlot<T>(task: () => Promise<T>): Promise<T> {
    while (this.active >= Math.max(this.maxConcurrency, 1)) {
      await sleep(5)
    }

    this.active += 1
    try {
      const now = Date.now() / 1000
      const waitSeconds = Math.max(this.lastRequestAt + Math.max(this.minIntervalSeconds, 0) - now, 0)
      if (waitSeconds > 0) await sleep(waitSeconds * 1000)
      this.lastRequestAt = Date.now() / 1000
      return await task()
    } finally {
      this.active -= 1
    }
  }
}

export function buildKimiHeaders(options: {
  baseUrl: string
  timezone?: string
  acceptLanguage?: string
  token?: string
  deviceId?: string
  sessionId?: string
  extra?: Record<string, string>
}): Record<string, string> {
  const headers: Record<string, string> = {
    ...FAKE_HEADERS,
    'Accept-Language': options.acceptLanguage || 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    Origin: options.baseUrl.replace(/\/+$/, ''),
    'R-Timezone': options.timezone || 'Asia/Shanghai',
    'X-Msh-Platform': 'web',
  }
  if (options.deviceId) headers['X-Msh-Device-Id'] = options.deviceId
  if (options.sessionId) headers['X-Msh-Session-Id'] = options.sessionId
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  if (options.extra) Object.assign(headers, options.extra)
  return headers
}

export function retryAfterSeconds(headers: Headers): number | undefined {
  const value = headers.get('Retry-After')
  if (!value) return undefined

  const numeric = Number(value)
  if (Number.isFinite(numeric)) return Math.max(numeric, 0)

  const ts = Date.parse(value)
  if (!Number.isNaN(ts)) return Math.max((ts - Date.now()) / 1000, 0)
  return undefined
}

export function retryBackoffSeconds(attempt: number): number {
  return Math.min(0.5 * attempt, 2.0) + Math.random() * 0.2
}

export function classifyUpstreamStatus(statusCode: number): string {
  if (statusCode === 401) return 'unauthorized'
  if (statusCode === 403) return 'forbidden'
  if (statusCode === 429) return 'rate_limited'
  if (statusCode >= 500 && statusCode <= 599) return 'server_error'
  if (statusCode > 0) return 'upstream_error'
  return ''
}

export function processSessionId(): string {
  return _processSessionId
}

export function loadOrCreateClientIdentity(): KimiClientIdentity {
  return {
    deviceId: generateDeviceId(),
    createdAt: Date.now() / 1000,
  }
}

export class KimiTransport {
  readonly baseUrl: string
  readonly timeout: number
  readonly maxRetries: number
  private readonly rateLimiter: RateLimiter

  constructor(options: TransportOptions = {}) {
    this.baseUrl = (options.baseUrl || 'https://www.kimi.com').replace(/\/+$/, '')
    this.timeout = options.timeout ?? 30
    this.maxRetries = Math.max(options.maxRetries ?? 3, 1)
    this.rateLimiter = options.rateLimiter || new RateLimiter(1, 0)
  }

  private toUrl(pathOrUrl: string): string {
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) return pathOrUrl
    return `${this.baseUrl}${pathOrUrl}`
  }

  async request(method: string, pathOrUrl: string, options: FetchOptions = {}): Promise<Response> {
    const retryableStatusCodes = options.retryableStatusCodes || RETRYABLE_STATUS_CODES
    let lastError: unknown

    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await this.rateLimiter.withSlot(async () => {
          return fetchWithTimeout(this.toUrl(pathOrUrl), {
            ...options,
            method,
          }, options.timeout ?? this.timeout)
        })

        if (!retryableStatusCodes.includes(response.status) || attempt === this.maxRetries) {
          return response
        }

        const delay = retryAfterSeconds(response.headers) ?? retryBackoffSeconds(attempt)
        await sleep(delay * 1000)
      } catch (error) {
        lastError = error
        if (attempt === this.maxRetries) break
        await sleep(retryBackoffSeconds(attempt) * 1000)
      }
    }

    if (lastError instanceof Error) throw lastError
    throw new Error('Kimi request failed without a detailed error')
  }

  async *stream(method: string, pathOrUrl: string, options: FetchOptions = {}): AsyncGenerator<Uint8Array> {
    const response = await this.request(method, pathOrUrl, options)
    const reader = response.body?.getReader()
    if (!reader) return

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) yield value
      }
    } finally {
      reader.releaseLock()
    }
  }
}

const _processSessionId = generateSessionId()

const sharedTransports = new Map<string, KimiTransport>()

export function getSharedTransport(options: TransportOptions = {}): KimiTransport {
  const baseUrl = (options.baseUrl || 'https://www.kimi.com').replace(/\/+$/, '')
  const timeout = options.timeout ?? 30
  const maxRetries = Math.max(options.maxRetries ?? 3, 1)
  const key = `${baseUrl}|${timeout}|${maxRetries}`
  const found = sharedTransports.get(key)
  if (found) return found
  const created = new KimiTransport({ baseUrl, timeout, maxRetries })
  sharedTransports.set(key, created)
  return created
}

export function closeSharedTransports(): void {
  sharedTransports.clear()
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutSeconds: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.max(timeoutSeconds, 0) * 1000)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(ms, 0)))
}
