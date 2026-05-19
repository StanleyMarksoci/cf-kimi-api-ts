import { SignJWT, jwtVerify } from 'jose'

const SESSION_DURATION_SECONDS = 86400

export interface SessionPayload {
  username: string
  role: string
  [key: string]: unknown
}

export async function createSession(secret: string, payload: SessionPayload): Promise<string> {
  const key = new TextEncoder().encode(secret)
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(key)
}

export async function verifySession(secret: string, token: string): Promise<SessionPayload | null> {
  try {
    const key = new TextEncoder().encode(secret)
    const { payload } = await jwtVerify(token, key)
    const username = typeof payload.username === 'string' ? payload.username : ''
    const role = typeof payload.role === 'string' ? payload.role : ''
    if (!username || !role) return null
    return { username, role }
  } catch {
    return null
  }
}
