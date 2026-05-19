import { ConversationContext, KimiAPIError, THINKING_STAGE_NAME } from './protocol'

export function updateContextFromEvent(context: ConversationContext, event: Record<string, any>): void {
  if (event.chat?.id) context.remoteChatId = event.chat.id
  if (event.message?.role === 'assistant' && event.message?.id) {
    context.lastAssistantMessageId = event.message.id
  }
}

export function extractExplicitPhase(event: Record<string, any>): 'thinking' | 'answer' | undefined {
  const stages = event.block?.multiStage?.stages
  if (Array.isArray(stages) && stages.length > 0) {
    const first = stages[0]
    if (first?.name === THINKING_STAGE_NAME) {
      return first?.status === 'completed' ? 'answer' : 'thinking'
    }
  }

  const flags = event.block?.text?.flags
  if (flags === 'thinking') return 'thinking'
  if (flags === 'answer') return 'answer'
  return undefined
}

export function extractDelta(
  event: Record<string, any>,
  currentPhase?: 'thinking' | 'answer',
): { phase?: 'thinking' | 'answer'; content?: string; reasoning_content?: string } {
  if (event.heartbeat) return { phase: currentPhase }

  const explicitPhase = extractExplicitPhase(event)
  const phase = explicitPhase || currentPhase
  const mask = String(event.mask || '')

  if (mask.includes('block.think')) {
    return {
      phase: phase || 'thinking',
      reasoning_content: event.block?.think?.content,
    }
  }

  if (mask.includes('block.text')) {
    const content = event.block?.text?.content
    if (explicitPhase === 'thinking') return { phase, reasoning_content: content }
    return {
      phase: explicitPhase ? phase : 'answer',
      content,
    }
  }

  const content = event.block?.text?.content
  if (explicitPhase === 'thinking') return { phase, reasoning_content: content }
  if (content != null) {
    return {
      phase: explicitPhase ? phase : 'answer',
      content,
    }
  }
  return { phase }
}

export async function* iterGrpcEvents(
  response: Response,
  context: ConversationContext,
): AsyncGenerator<Record<string, any>> {
  const reader = response.body?.getReader()
  if (!reader) return

  let buffer = new Uint8Array(0)
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      const combined = new Uint8Array(buffer.length + value.length)
      combined.set(buffer, 0)
      combined.set(value, buffer.length)

      let offset = 0
      while (offset + 5 <= combined.length) {
        const flag = combined[offset]
        const length = new DataView(combined.buffer, combined.byteOffset + offset + 1, 4).getUint32(0, false)
        const frameEnd = offset + 5 + length
        if (frameEnd > combined.length) break

        const payload = combined.slice(offset + 5, frameEnd)
        offset = frameEnd

        if (flag & 0x80) continue

        const text = decoder.decode(payload).trim()
        if (!text) continue

        let event: Record<string, any>
        try {
          event = JSON.parse(text) as Record<string, any>
        } catch {
          continue
        }

        if (event.error) {
          const error = event.error as Record<string, unknown>
          throw new KimiAPIError(String(error.message || JSON.stringify(error)))
        }

        updateContextFromEvent(context, event)
        yield event
      }

      buffer = combined.slice(offset)
    }
  } catch (error) {
    if (error instanceof KimiAPIError) throw error
    throw new KimiAPIError(`Kimi upstream stream interrupted: ${String(error)}`, {
      upstreamErrorType: 'stream_interrupted',
    })
  } finally {
    reader.releaseLock()
  }
}
