import type { KimiAccountConfig } from '../stores/accounts'
import { getTokenCache, setTokenCache } from '../stores/tokens'
import { detectTokenType, KimiAPIError, parseJwt } from '../kimi/protocol'
import { buildKimiHeaders, retryAfterSeconds } from '../kimi/transport'

const KIMI_REFRESH_PATH = '/api/auth/token/refresh'
const REFRESH_BUFFER_SECONDS = 300

export interface TokenState {
  accessToken: string
  refreshToken: string | null
  expiresAt: number
  tokenType: 'jwt' | 'refresh'
}

function parseExpiresAt(token: string): number {
  const payload = parseJwt(token)
  const exp = Number(payload?.exp ?? 0)
  return Number.isFinite(exp) ? exp : 0
}

export class TokenManager {
  private readonly kv: KVNamespace
  private readonly accountId: string
  private readonly baseUrl: string
  private readonly deviceId: string
  private readonly sessionId: string
  private state: TokenState
  private refreshing: Promise<void> | null = null

  constructor(
    account: KimiAccountConfig,
    options: { kv: KVNamespace; baseUrl?: string; sessionId: string },
  ) {
    this.kv = options.kv
    this.accountId = account.id
    this.baseUrl = (options.baseUrl || 'https://www.kimi.com').replace(/\/+$/, '')
    this.deviceId = account.deviceId
    this.sessionId = options.sessionId
    this.state = this.initialize(account)
  }

  getState(): TokenState {
    return { ...this.state }
  }

  async getAccessToken(): Promise<string> {
    if (this.needsRefresh()) await this.refreshOnce()
    return this.state.accessToken
  }

  async invalidateAndRetry(): Promise<void> {
    await this.refreshOnce()
  }

  private initialize(account: KimiAccountConfig): TokenState {
    const rawToken = account.rawToken.trim()
    if (detectTokenType(rawToken) === 'jwt') {
      return {
        accessToken: rawToken,
        refreshToken: null,
        expiresAt: parseExpiresAt(rawToken),
        tokenType: 'jwt',
      }
    }

    const cachedToken = account.cachedAccessToken.trim()
    if (cachedToken && detectTokenType(cachedToken) === 'jwt') {
      const parsedExp = parseExpiresAt(cachedToken)
      const expiresAt = parsedExp || Number(account.cachedAccessExpiresAt || 0)
      if (expiresAt > 0) {
        return {
          accessToken: cachedToken,
          refreshToken: rawToken,
          expiresAt,
          tokenType: 'jwt',
        }
      }
    }

    return {
      accessToken: rawToken,
      refreshToken: rawToken,
      expiresAt: 0,
      tokenType: 'refresh',
    }
  }

  private needsRefresh(): boolean {
    if (this.state.tokenType === 'refresh') return true
    if (this.state.expiresAt <= 0) return false
    return Date.now() / 1000 > this.state.expiresAt - REFRESH_BUFFER_SECONDS
  }

  private async refreshOnce(): Promise<void> {
    if (this.refreshing) return this.refreshing
    this.refreshing = this.doRefresh().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  private async doRefresh(): Promise<void> {
    const refreshToken = this.state.refreshToken
    if (!refreshToken) {
      throw new KimiAPIError('No refresh token available', { upstreamErrorType: 'token_refresh_failed' })
    }

    const response = await fetch(`${this.baseUrl}${KIMI_REFRESH_PATH}`, {
      method: 'GET',
      headers: buildKimiHeaders({
        baseUrl: this.baseUrl,
        token: refreshToken,
        deviceId: this.deviceId,
        sessionId: this.sessionId,
      }),
    })

    if (response.status !== 200) {
      const body = (await response.text()).slice(0, 200)
      throw new KimiAPIError(`Kimi token refresh failed with status ${response.status}: ${body || '<empty>'}`, {
        upstreamStatusCode: response.status,
        upstreamErrorType: 'token_refresh_failed',
        retryAfter: retryAfterSeconds(response.headers),
      })
    }

    const payload = (await response.json()) as { access_token?: string; token?: string }
    const nextToken = (payload.access_token || payload.token || '').trim()
    if (!nextToken) {
      throw new KimiAPIError('Kimi token refresh response did not include an access token', {
        upstreamStatusCode: 200,
        upstreamErrorType: 'token_refresh_failed',
      })
    }

    const expiresAt = parseExpiresAt(nextToken)
    this.state = {
      accessToken: nextToken,
      refreshToken,
      expiresAt,
      tokenType: 'jwt',
    }

    await setTokenCache(this.kv, this.accountId, {
      accessToken: nextToken,
      expiresAt,
      updatedAt: Math.floor(Date.now() / 1000),
    })
  }

  async hydrateFromCache(): Promise<void> {
    const cache = await getTokenCache(this.kv, this.accountId)
    if (!cache?.accessToken) return
    if (detectTokenType(cache.accessToken) !== 'jwt') return

    const cachedExpiresAt = parseExpiresAt(cache.accessToken) || Number(cache.expiresAt || 0)
    if (cachedExpiresAt <= 0) return
    if (cachedExpiresAt <= Date.now() / 1000) return

    this.state = {
      accessToken: cache.accessToken,
      refreshToken: this.state.refreshToken,
      expiresAt: cachedExpiresAt,
      tokenType: 'jwt',
    }
  }
}
