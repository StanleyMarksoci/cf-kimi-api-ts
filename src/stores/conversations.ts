export interface StoredConversation {
  remoteChatId: string
  lastAssistantMessageId: string
  createdAt: number
}

const KV_PREFIX = 'conv:'
const TTL_SECONDS = 86400 * 7 // 7 天自动过期

export async function getConversation(
  kv: KVNamespace,
  conversationId: string
): Promise<StoredConversation | null> {
  const data = await kv.get(`${KV_PREFIX}${conversationId}`, 'json')
  return data as StoredConversation | null
}

export async function saveConversation(
  kv: KVNamespace,
  conversationId: string,
  conv: StoredConversation
): Promise<void> {
  await kv.put(`${KV_PREFIX}${conversationId}`, JSON.stringify(conv), {
    expirationTtl: TTL_SECONDS,
  })
}

export async function deleteConversation(
  kv: KVNamespace,
  conversationId: string
): Promise<void> {
  await kv.delete(`${KV_PREFIX}${conversationId}`)
}
