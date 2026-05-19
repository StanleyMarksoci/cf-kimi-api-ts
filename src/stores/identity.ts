export interface ClientIdentity {
  deviceId: string
  createdAt: number
}

const KV_KEY = 'identity:device_id'

function generateDeviceId(): string {
  const value = Math.floor(Math.random() * 9_000_000_000_000_000_000 + 7_000_000_000_000_000_000)
  return String(value)
}

export async function loadOrCreateIdentity(kv: KVNamespace): Promise<ClientIdentity> {
  const existing = (await kv.get(KV_KEY, 'json')) as ClientIdentity | null
  if (existing && typeof existing.deviceId === 'string' && existing.deviceId.length >= 16) {
    return existing
  }

  const identity: ClientIdentity = {
    deviceId: generateDeviceId(),
    createdAt: Math.floor(Date.now() / 1000),
  }

  await kv.put(KV_KEY, JSON.stringify(identity))
  return identity
}
