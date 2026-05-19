import { KimiAPIError, generateSessionId } from '../kimi/protocol'
import { KimiTransport, RateLimiter, getSharedTransport } from '../kimi/transport'
import type { AccountPool as KimiAccountPool, AccountRuntime as KimiAccountRuntime } from '../kimi/client'
import type { KimiAccountConfig } from '../stores/accounts'
import { TokenManager } from './token-manager'

const DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS = 60
const DEFAULT_TRANSIENT_COOLDOWN_SECONDS = 30

export interface AccountRuntime extends KimiAccountRuntime {
  account: KimiAccountConfig
  tokenManager: TokenManager
  transport: KimiTransport
  inFlight: number
  cooldownUntil: number
  unhealthyError: string
}

export class AccountPool implements KimiAccountPool {
  readonly configured: boolean
  private readonly runtimes: AccountRuntime[]
  private rrCursor = 0

  constructor(
    accounts: KimiAccountConfig[],
    options: { kv: KVNamespace; baseUrl?: string; timeout?: number; maxRetries?: number },
  ) {
    const baseUrl = (options.baseUrl || 'https://www.kimi.com').replace(/\/+$/, '')
    const timeout = options.timeout ?? 30
    const maxRetries = Math.max(options.maxRetries ?? 3, 1)

    this.runtimes = accounts.map((account) => {
      const sessionId = generateSessionId()
      const tokenManager = new TokenManager(account, {
        kv: options.kv,
        baseUrl,
        sessionId,
      })
      const transport = getSharedTransport({
        baseUrl,
        timeout,
        maxRetries,
        rateLimiter: new RateLimiter(account.maxConcurrency, account.minIntervalSeconds),
      })

      return {
        accountId: account.id,
        accountName: account.name,
        account,
        tokenManager,
        transport,
        sessionId,
        inFlight: 0,
        cooldownUntil: 0,
        unhealthyError: '',
      }
    })

    this.configured = this.runtimes.length > 0
  }

  accountCount(): number {
    return this.runtimes.length
  }

  async acquire(options?: { exclude?: Set<string> }): Promise<AccountRuntime> {
    const selected = this.select(options?.exclude)
    await selected.tokenManager.hydrateFromCache()
    return selected
  }

  release(runtime: KimiAccountRuntime, _error?: unknown): void {
    const local = runtime as AccountRuntime
    local.inFlight = Math.max(local.inFlight - 1, 0)
  }

  recordSuccess(runtime: KimiAccountRuntime): void {
    const local = runtime as AccountRuntime
    local.cooldownUntil = 0
    local.unhealthyError = ''
  }

  recordFailure(runtime: KimiAccountRuntime, error: unknown): void {
    const local = runtime as AccountRuntime
    const now = Date.now() / 1000
    if (error instanceof KimiAPIError) {
      if (error.upstreamErrorType === 'token_refresh_failed' || [401, 403].includes(error.upstreamStatusCode)) {
        local.unhealthyError = error.message
        local.cooldownUntil = 0
        return
      }
      if (error.upstreamStatusCode === 429 || error.upstreamErrorType === 'rate_limited') {
        local.cooldownUntil = now + (error.retryAfter ?? DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS)
        return
      }
      if (
        (error.upstreamStatusCode >= 500 && error.upstreamStatusCode <= 599) ||
        ['server_error', 'network_error', 'stream_interrupted'].includes(error.upstreamErrorType)
      ) {
        local.cooldownUntil = now + DEFAULT_TRANSIENT_COOLDOWN_SECONDS
        return
      }
    }
    local.cooldownUntil = now + DEFAULT_TRANSIENT_COOLDOWN_SECONDS
  }

  private select(exclude?: Set<string>): AccountRuntime {
    const now = Date.now() / 1000
    const candidates = this.runtimes.filter((runtime) => {
      return (
        runtime.account.enabled &&
        !runtime.unhealthyError &&
        runtime.cooldownUntil <= now &&
        runtime.inFlight < runtime.account.maxConcurrency &&
        !exclude?.has(runtime.account.id)
      )
    })

    if (candidates.length === 0) {
      throw new KimiAPIError('No available Kimi accounts', { upstreamErrorType: 'no_available_account' })
    }

    const minInFlight = Math.min(...candidates.map((runtime) => runtime.inFlight))
    const tiedIds = new Set(candidates.filter((runtime) => runtime.inFlight === minInFlight).map((runtime) => runtime.account.id))
    const ordered = this.runtimes.slice(this.rrCursor).concat(this.runtimes.slice(0, this.rrCursor))
    const selected = ordered.find((runtime) => tiedIds.has(runtime.account.id))
    if (!selected) {
      throw new KimiAPIError('No available Kimi accounts', { upstreamErrorType: 'no_available_account' })
    }

    selected.inFlight += 1
    const selectedIndex = this.runtimes.findIndex((runtime) => runtime.account.id === selected.account.id)
    this.rrCursor = (selectedIndex + 1) % Math.max(this.runtimes.length, 1)
    return selected
  }
}
