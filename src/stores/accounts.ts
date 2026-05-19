export interface KimiAccountConfig {
  id: string
  name: string
  rawToken: string
  enabled: boolean
  maxConcurrency: number
  minIntervalSeconds: number
  deviceId: string
  createdAt: number
  updatedAt: number
  cachedAccessToken: string
  cachedAccessExpiresAt: number
  cachedAccessUpdatedAt: number
}

const KV_KEY = 'kimi:accounts'

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`
}

function defaultAccount(token: string, name?: string): KimiAccountConfig {
  const ts = nowUnix()
  return {
    id: randomId('acc'),
    name: name?.trim() || 'Kimi Account',
    rawToken: token,
    enabled: true,
    maxConcurrency: 1,
    minIntervalSeconds: 0,
    deviceId: '',
    createdAt: ts,
    updatedAt: ts,
    cachedAccessToken: '',
    cachedAccessExpiresAt: 0,
    cachedAccessUpdatedAt: 0,
  }
}

export async function loadAccounts(kv: KVNamespace): Promise<KimiAccountConfig[]> {
  const data = await kv.get(KV_KEY, 'json')
  return Array.isArray(data) ? (data as KimiAccountConfig[]) : []
}

export async function saveAccounts(kv: KVNamespace, accounts: KimiAccountConfig[]): Promise<void> {
  await kv.put(KV_KEY, JSON.stringify(accounts), {
    metadata: { updatedAt: Date.now() },
  })
}

export async function addAccount(
  kv: KVNamespace,
  token: string,
  name?: string
): Promise<KimiAccountConfig> {
  const accounts = await loadAccounts(kv)
  const created = defaultAccount(token, name)
  accounts.push(created)
  await saveAccounts(kv, accounts)
  return created
}

export async function updateAccount(
  kv: KVNamespace,
  id: string,
  changes: Partial<KimiAccountConfig>
): Promise<KimiAccountConfig | null> {
  const accounts = await loadAccounts(kv)
  const idx = accounts.findIndex((item) => item.id === id)
  if (idx < 0) return null

  const current = accounts[idx]
  const next: KimiAccountConfig = {
    ...current,
    ...changes,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: nowUnix(),
  }

  accounts[idx] = next
  await saveAccounts(kv, accounts)
  return next
}

export async function deleteAccount(kv: KVNamespace, id: string): Promise<boolean> {
  const accounts = await loadAccounts(kv)
  const filtered = accounts.filter((item) => item.id !== id)
  if (filtered.length === accounts.length) return false
  await saveAccounts(kv, filtered)
  return true
}

export async function getAccount(kv: KVNamespace, id: string): Promise<KimiAccountConfig | null> {
  const accounts = await loadAccounts(kv)
  return accounts.find((item) => item.id === id) ?? null
}
