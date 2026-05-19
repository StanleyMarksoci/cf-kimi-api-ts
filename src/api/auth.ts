import type { Context, Next } from 'hono'
import type { Env } from '../config'
import type { ApiKey } from '../stores/keys'
import { getKey, touchKey } from '../stores/keys'
import { jsonError } from './errors'

export interface ApiAuthVariables {
  apiKey: ApiKey
}

export async function verifyApiKey(c: Context<{ Bindings: Env; Variables: ApiAuthVariables }>, next: Next) {
  const auth = c.req.header('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) {
    return jsonError('Missing bearer token', 'invalid_request_error', 401)
  }

  const key = auth.slice(7).trim()
  if (!key) {
    return jsonError('Invalid API key', 'invalid_request_error', 401)
  }

  const apiKey = await getKey(c.env.KV, key)
  if (!apiKey) {
    return jsonError('Invalid API key', 'invalid_request_error', 401)
  }

  await touchKey(c.env.KV, key)
  c.set('apiKey', apiKey)
  await next()
}
