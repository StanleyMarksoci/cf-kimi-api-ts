export interface TokenCache {
  accessToken: string
  expiresAt: number
  updatedAt: number
}

function tokenCacheKey(accountId: string): string {
  return `token:cache:${accountId}`
}

export async function getTokenCache(
  kv: KVNamespace,
  accountId: string
): Promise<TokenCache | null> {
  const data = await kv.get(tokenCacheKey(accountId), 'json')
  return (data as TokenCache | null) ?? null
}

export async function setTokenCache(
  kv: KVNamespace,
  accountId: string,
  cache: TokenCache
): Promise<void> {
  const ttl = Math.max(Math.ceil(cache.expiresAt - Date.now() / 1000), 60)
  await kv.put(tokenCacheKey(accountId), JSON.stringify(cache), { expirationTtl: ttl })
}

export async function clearTokenCache(kv: KVNamespace, accountId: string): Promise<void> {
  await kv.delete(tokenCacheKey(accountId))
}
