export interface ApiKey {
  key: string
  name: string
  createdAt: number
  lastUsed: number
  requestCount: number
}

const KV_KEY = 'keys:list'

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}

function createRawKey(): string {
  return `sk-${crypto.randomUUID().replace(/-/g, '')}`
}

export async function loadKeys(kv: KVNamespace): Promise<ApiKey[]> {
  const data = await kv.get(KV_KEY, 'json')
  return Array.isArray(data) ? (data as ApiKey[]) : []
}

export async function saveKeys(kv: KVNamespace, keys: ApiKey[]): Promise<void> {
  await kv.put(KV_KEY, JSON.stringify(keys), {
    metadata: { updatedAt: Date.now() },
  })
}

export async function createKey(kv: KVNamespace, name?: string): Promise<ApiKey> {
  const keys = await loadKeys(kv)
  const now = nowUnix()
  const item: ApiKey = {
    key: createRawKey(),
    name: name?.trim() || `Key ${keys.length + 1}`,
    createdAt: now,
    lastUsed: 0,
    requestCount: 0,
  }
  keys.push(item)
  await saveKeys(kv, keys)
  return item
}

export async function deleteKey(kv: KVNamespace, key: string): Promise<boolean> {
  const keys = await loadKeys(kv)
  const filtered = keys.filter((item) => item.key !== key)
  if (filtered.length === keys.length) return false
  await saveKeys(kv, filtered)
  return true
}

export async function getKey(kv: KVNamespace, key: string): Promise<ApiKey | null> {
  const keys = await loadKeys(kv)
  return keys.find((item) => item.key === key) ?? null
}

export async function touchKey(kv: KVNamespace, key: string): Promise<void> {
  const keys = await loadKeys(kv)
  const idx = keys.findIndex((item) => item.key === key)
  if (idx < 0) return

  const curr = keys[idx]
  keys[idx] = {
    ...curr,
    lastUsed: nowUnix(),
    requestCount: curr.requestCount + 1,
  }
  await saveKeys(kv, keys)
}
