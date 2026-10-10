/**
 * The few HTTP chores the local host needs, on bare `node:http`.
 *
 * Every answer is JSON (or a redirect). Bodies are read up to 1 MiB and
 * refused past it; JSON routes refuse any other content type. Nothing here
 * logs — a request carries session tokens, and a development server's console
 * is copied into bug reports.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** Request bodies past this size are refused with 413. */
export const MAX_BODY_BYTES = 1024 * 1024

/** A failure that becomes `{ error: { code, message } }` with `status`. */
export class HostError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(text)),
    ...headers,
  })
  res.end(text)
}

export function sendError(res: ServerResponse, err: HostError): void {
  sendJson(res, err.status, { error: { code: err.code, message: err.message } })
}

/** `302` to `location`, with any cookies to set on the way. */
export function redirect(res: ServerResponse, location: string, cookies: readonly string[] = []): void {
  res.writeHead(302, {
    location,
    'cache-control': 'no-store',
    ...(cookies.length > 0 ? { 'set-cookie': [...cookies] } : {}),
  })
  res.end()
}

/** The raw body, refused past `MAX_BODY_BYTES`. */
export function readBody(req: IncomingMessage): Promise<string> {
  const tooLarge = (): HostError => new HostError(413, 'PAYLOAD_TOO_LARGE', 'The request body is larger than 1 MiB.')
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    req.resume()
    return Promise.reject(tooLarge())
  }
  // Listeners, not an async iterator: leaving an iterator early destroys the
  // socket, and the refusal would never reach the client. Past the limit the
  // rest of the body is drained and dropped while the 413 goes out.
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let refused = false
    req.on('data', (chunk: Buffer | string) => {
      if (refused) return
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      size += buf.length
      if (size > MAX_BODY_BYTES) {
        refused = true
        chunks.length = 0
        reject(tooLarge())
        return
      }
      chunks.push(buf)
    })
    req.on('end', () => {
      if (!refused) resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

function mediaTypeOf(req: IncomingMessage): string {
  return String(req.headers['content-type'] ?? '')
    .split(';')[0]!
    .trim()
    .toLowerCase()
}

/** A JSON object body. An empty body is `{}`; anything else that is not an object is refused. */
export async function readJsonObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  const text = await readBody(req)
  if (text.trim() === '') return {}
  if (mediaTypeOf(req) !== 'application/json') {
    throw new HostError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the body as application/json.')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new HostError(400, 'INVALID_JSON', 'The request body is not valid JSON.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HostError(400, 'INVALID_BODY', 'The request body must be a JSON object.')
  }
  return parsed as Record<string, unknown>
}

/** A form-encoded body (the OAuth token endpoint's only format). */
export async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const text = await readBody(req)
  if (mediaTypeOf(req) !== 'application/x-www-form-urlencoded') {
    throw new HostError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the body as application/x-www-form-urlencoded.')
  }
  return new URLSearchParams(text)
}

export function cookiesOf(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at <= 0) continue
    const name = part.slice(0, at).trim()
    const value = part.slice(at + 1).trim()
    try {
      out[name] = decodeURIComponent(value)
    } catch {
      out[name] = value
    }
  }
  return out
}

/**
 * The visitor's credential: `x-app-session`, else `Authorization: Bearer`.
 * The session protocol accepts either on every session-server route.
 */
export function credentialOf(req: IncomingMessage): string | undefined {
  const session = req.headers['x-app-session']
  if (typeof session === 'string' && session.trim()) return session.trim()
  const auth = req.headers.authorization
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(auth)
    if (m) return m[1]
  }
  return undefined
}

/**
 * Only a path on the app's own origin may be the way back — the same rule the
 * runner applies before it builds a start address (`//host` and `/\host` are
 * other sites to a browser).
 */
export function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/')) return '/'
  const second = value.charAt(1)
  return second === '/' || second === '\\' ? '/' : value
}
