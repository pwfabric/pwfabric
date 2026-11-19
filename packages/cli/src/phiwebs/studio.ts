/**
 * The PhiWebs studio as `pwf publish` and `pwf mcp` reach it: its HTTP routes
 * for importing and publishing a project, and its MCP endpoint. Every call
 * carries the studio's access token from the signed-in session; nothing here
 * runs for a command that needs no account.
 *
 * A refusal keeps the studio's code (`{ error, code }` bodies) and gains the
 * line that says what to do about it.
 */
import { CommandFailure } from '../commands/lib/failure.js'
import type { Fetch } from './oauth.js'

/** The studio routes pwf calls. */
export const STUDIO_PATHS = {
  /** Creates a project from a .pwpack (raw body); `?name=` names it. */
  importNew: '/s/projects/import',
  /** Replaces a project's app with a .pwpack (raw body), as a new checkpoint. */
  importInto: (id: string) => `/s/p/${encodeURIComponent(id)}/import`,
  /** Wakes a project (publishing needs it awake). */
  open: (id: string) => `/s/p/${encodeURIComponent(id)}/open`,
  /** Publishes a project; answers `{ app, version, url }`. */
  publish: (id: string) => `/s/p/${encodeURIComponent(id)}/publish`,
  /** The remote MCP endpoint (stateless Streamable HTTP, JSON answers). */
  mcp: '/mcp',
} as const

/** Publishing builds the app on the studio: allow it time. */
const LONG_TIMEOUT_MS = 15 * 60_000
const SHORT_TIMEOUT_MS = 30_000

/** One validation finding, as the studio lists them. */
export interface StudioFinding {
  readonly severity: 'error' | 'warning' | 'info'
  readonly code: string
  readonly message: string
  readonly path?: string
}

/** What to do about a studio refusal, by its code. */
export function studioFix(code: string, extra: Readonly<Record<string, unknown>> = {}): string {
  const packs = Array.isArray(extra['packs']) ? (extra['packs'] as unknown[]).filter((p) => typeof p === 'string').join(', ') : ''
  switch (code) {
    case 'UNAUTHORIZED':
    case 'SESSION_REFUSED':
      return 'Run `pwf login` to sign in again.'
    case 'INSUFFICIENT_SCOPE':
      return `Run \`pwf login\` again and approve ${typeof extra['scope'] === 'string' ? extra['scope'] : 'every permission it asks for'}.`
    case 'PACK_NOT_AVAILABLE':
      return `Install ${packs || 'the packs named above'} in your PhiWebs workspace (its marketplace), or pin only open packs, then publish again.`
    case 'PROJECT_NOT_FOUND':
    case 'NOT_FOUND':
    case 'FORBIDDEN':
      return 'This workspace has no such project. Run `pwf publish --new` to make a new one, or pass --project with one of your projects.'
    case 'PACK_TOO_LARGE':
      return 'The .pwpack is larger than the upload limit. Leave large media out of the folder, or make it smaller.'
    case 'STUDIO_BUSY':
      return 'Every studio slot is in use right now. Try again in a minute.'
    case 'VALIDATE_FAILED':
    case 'PROJECT_INVALID':
      return 'Fix each finding by its code and path (`pwf validate` lists them), then publish again.'
    case 'ROLE_REQUIRED':
      return 'Only a workspace owner or admin can do this. Ask one of them.'
    case 'SUBSCRIPTION_INACTIVE':
    case 'WORLD_SUSPENDED':
      return "The workspace's subscription is not active. The owner renews it in their PhiWebs account."
    case 'LIVE_APPS_LIMIT':
      return 'The plan allows no more live apps. Unpublish another app, or the owner upgrades the plan in their PhiWebs account.'
    case 'PUBLISH_CHECK_UNAVAILABLE':
    case 'STUDIO_UNREACHABLE':
    case 'PUBLISH_FAILED':
      return 'Nothing was published. Try again in a moment.'
    default:
      if (/TERMS/i.test(code)) return 'Accept the publisher terms in your PhiWebs account, then publish again.'
      if (/LIMIT|CREDIT|USAGE|QUOTA|PLAN/i.test(code)) return 'A plan limit is reached; the message says which. The workspace owner can change the plan in their PhiWebs account.'
      return 'Read the message, fix what it says, and try again.'
  }
}

/** A studio refusal as a command failure: the code, the message, and the fix on its own line. */
export function studioFailure(code: string, message: string, extra: Readonly<Record<string, unknown>> = {}, issues: readonly StudioFinding[] = []): CommandFailure {
  return new CommandFailure(code, message, {
    lines: [`${code}: ${message}`, `fix: ${studioFix(code, extra)}`],
    issues: issues.map((i) => ({ severity: i.severity, code: i.code, message: i.message, ...(i.path ? { path: i.path } : {}) })),
    issuesFirst: true,
  })
}

async function bodyOf(res: Response): Promise<unknown> {
  const text = await res.text()
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/** The code a refusal carries: the body's, else the one its status means. */
function refusal(res: Response, body: unknown, what: string): CommandFailure {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const challenge = res.headers.get('www-authenticate') ?? ''
  let code = typeof b['code'] === 'string' ? b['code'] : undefined
  const extra: Record<string, unknown> = { ...b }
  if (res.status === 401) code = 'SESSION_REFUSED'
  else if (res.status === 403 && /insufficient_scope/.test(challenge)) {
    code = 'INSUFFICIENT_SCOPE'
    const scope = /scope="([^"]*)"/.exec(challenge)?.[1]
    if (scope) extra['scope'] = scope
  } else if (code === undefined) code = res.status === 413 ? 'PACK_TOO_LARGE' : res.status === 404 ? 'NOT_FOUND' : res.status === 503 ? 'STUDIO_BUSY' : 'STUDIO_REFUSED'
  const message =
    code === 'SESSION_REFUSED'
      ? 'the studio no longer accepts the saved session'
      : typeof b['error'] === 'string'
        ? b['error']
        : typeof b['message'] === 'string'
          ? b['message']
          : `${what} answered HTTP ${res.status}`
  const findings = Array.isArray(b['findings']) ? (b['findings'] as StudioFinding[]) : []
  return studioFailure(code, message, extra, findings)
}

export interface StudioClientOptions {
  /** The studio's address. */
  readonly studio: string
  readonly accessToken: string
  readonly fetch?: Fetch
}

async function call(options: StudioClientOptions, method: string, path: string, init: { body?: string | Uint8Array; contentType?: string; timeoutMs?: number }): Promise<unknown> {
  const url = `${options.studio}${path}`
  let res: Response
  try {
    res = await (options.fetch ?? fetch)(url, {
      method,
      headers: {
        authorization: `Bearer ${options.accessToken}`,
        accept: 'application/json',
        ...(init.contentType ? { 'content-type': init.contentType } : {}),
      },
      ...(init.body !== undefined ? { body: init.body as NonNullable<RequestInit['body']> } : {}),
      signal: AbortSignal.timeout(init.timeoutMs ?? SHORT_TIMEOUT_MS),
    })
  } catch (e) {
    throw studioFailure('STUDIO_UNREACHABLE', `cannot reach ${options.studio}: ${(e as Error).message}`)
  }
  const body = await bodyOf(res)
  if (!res.ok) throw refusal(res, body, `${method} ${url}`)
  return body
}

/** What an import answered. */
export interface ImportResult {
  readonly projectId: string
  readonly findings: readonly StudioFinding[]
}

function findingsOf(value: unknown): StudioFinding[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map((f) => ({
      severity: f['severity'] === 'error' || f['severity'] === 'warning' ? f['severity'] : 'info',
      code: typeof f['code'] === 'string' ? f['code'] : 'FINDING',
      message: typeof f['message'] === 'string' ? f['message'] : '',
      ...(typeof f['path'] === 'string' ? { path: f['path'] } : {}),
    }))
}

/**
 * Sends a .pwpack: into the project `projectId`, or as a new project named
 * `name` when there is none.
 */
export async function importPack(options: StudioClientOptions, bytes: Uint8Array, target: { projectId?: string; name?: string }): Promise<ImportResult> {
  const path = target.projectId
    ? STUDIO_PATHS.importInto(target.projectId)
    : `${STUDIO_PATHS.importNew}${target.name ? `?name=${encodeURIComponent(target.name)}` : ''}`
  const body = (await call(options, 'POST', path, { body: bytes, contentType: 'application/octet-stream', timeoutMs: LONG_TIMEOUT_MS })) as Record<string, unknown> | null
  const projectId = typeof body?.['projectId'] === 'string' ? body['projectId'] : target.projectId
  if (!projectId) throw studioFailure('STUDIO_REFUSED', 'the studio answered the import without a projectId')
  return { projectId, findings: findingsOf(body?.['findings']) }
}

/** What a publish answered. */
export interface PublishResult {
  readonly app: string
  readonly version: string
  readonly url: string
}

/** Publishes a project, waking it first when the studio says it is asleep. */
export async function publishProject(options: StudioClientOptions, projectId: string): Promise<PublishResult> {
  const once = async (): Promise<PublishResult> => {
    const body = (await call(options, 'POST', STUDIO_PATHS.publish(projectId), { body: '{}', contentType: 'application/json', timeoutMs: LONG_TIMEOUT_MS })) as Record<
      string,
      unknown
    > | null
    if (typeof body?.['url'] !== 'string' || typeof body['version'] !== 'string') {
      throw studioFailure('PUBLISH_FAILED', 'the studio answered the publish without an address')
    }
    return { app: typeof body['app'] === 'string' ? body['app'] : projectId, version: body['version'], url: body['url'] }
  }
  try {
    return await once()
  } catch (e) {
    if (!(e instanceof CommandFailure) || e.code !== 'NOT_OPEN') throw e
    await call(options, 'POST', STUDIO_PATHS.open(projectId), { body: '{}', contentType: 'application/json', timeoutMs: LONG_TIMEOUT_MS })
    return once()
  }
}

/** A JSON-RPC answer from the studio's MCP endpoint. */
export interface RpcAnswer {
  readonly result?: Record<string, unknown>
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown }
}

/** Sends one JSON-RPC request to the studio's MCP endpoint (stateless: no session to open first). */
export async function mcpRequest(options: StudioClientOptions, method: string, params: Record<string, unknown>, timeoutMs = 60_000): Promise<RpcAnswer> {
  const url = `${options.studio}${STUDIO_PATHS.mcp}`
  let res: Response
  try {
    res = await (options.fetch ?? fetch)(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.accessToken}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    throw studioFailure('STUDIO_UNREACHABLE', `cannot reach ${options.studio}: ${(e as Error).message}`)
  }
  const body = (await bodyOf(res)) as RpcAnswer | null
  if (res.status === 401) throw studioFailure('SESSION_REFUSED', 'the studio no longer accepts the saved session')
  if (body && typeof body === 'object' && (body.result || body.error)) return body
  throw studioFailure('STUDIO_REFUSED', `${url} answered HTTP ${res.status} without a JSON-RPC answer`)
}
