import {
  ChatCompletion,
  ChatCompletionChoice,
  ChatCompletionChunk,
  ChatCompletionMessage,
  ChatCompletionUsage,
} from './protocol'

export function buildChatCompletion(options: {
  completionId: string
  created: number
  model: string
  contentParts: string[]
  reasoningParts: string[]
}): ChatCompletion {
  const message: ChatCompletionMessage = {
    role: 'assistant',
    content: options.contentParts.join('').trim() || null,
    reasoning_content: options.reasoningParts.join('').trim() || null,
  }

  const choice: ChatCompletionChoice = {
    index: 0,
    message,
    finish_reason: 'stop',
  }

  const usage: ChatCompletionUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  }

  return {
    id: options.completionId,
    created: options.created,
    model: options.model,
    choices: [choice],
    usage,
    object: 'chat.completion',
  }
}

export function roleChunk(options: { chunkId: string; created: number; model: string }): ChatCompletionChunk {
  return {
    id: options.chunkId,
    created: options.created,
    model: options.model,
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
    object: 'chat.completion.chunk',
  }
}

export function contentChunk(options: {
  chunkId: string
  created: number
  model: string
  content: string
}): ChatCompletionChunk {
  return {
    id: options.chunkId,
    created: options.created,
    model: options.model,
    choices: [{ index: 0, delta: { content: options.content }, finish_reason: null }],
    object: 'chat.completion.chunk',
  }
}

export function reasoningChunk(options: {
  chunkId: string
  created: number
  model: string
  reasoningContent: string
}): ChatCompletionChunk {
  return {
    id: options.chunkId,
    created: options.created,
    model: options.model,
    choices: [{ index: 0, delta: { reasoning_content: options.reasoningContent }, finish_reason: null }],
    object: 'chat.completion.chunk',
  }
}

export function stopChunk(options: { chunkId: string; created: number; model: string }): ChatCompletionChunk {
  return {
    id: options.chunkId,
    created: options.created,
    model: options.model,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    object: 'chat.completion.chunk',
  }
}

export function newCreatedTimestamp(created?: number): number {
  return created || Math.floor(Date.now() / 1000)
}
