/**
 * Publishing a pack to the PhiWebs marketplace from a local folder: the
 * folder's deterministic .pwpack and its derived manifest go to the API's
 * artifact publish route as the signed-in workspace's publisher, and land in
 * review. The pack id is the folder's own: nothing here rewrites it.
 */
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { deriveManifest, packContent, type PackIssue } from '@pwfabric/pack'
import { CommandFailure } from '../commands/lib/failure.js'
import { readIdentityFile } from '../commands/lib/identity.js'
import { PWF_DIR, readProject } from '../commands/lib/project.js'
import { archiveName, packProject } from '../commands/pack.js'
import type { Fetch } from './oauth.js'

/** The API routes pack publishing calls (both need `marketplace:publish`). */
export const MARKETPLACE_PATHS = {
  /** The workspace's publisher registration. */
  publisher: '/api/marketplace/publishers/me',
  /** multipart: `file` (the .pwpack), `manifest` (its manifest, JSON), `scope`. */
  publish: '/api/marketplace/artifacts/publish',
} as const

const TIMEOUT_MS = 5 * 60_000

export interface MarketplaceOptions {
  /** The API. */
  readonly server: string
  /** An API-audience access token. */
  readonly accessToken: string
  readonly fetch?: Fetch
}

/** What to do about a refusal, by its code. */
export function marketplaceFix(code: string): string {
  switch (code) {
    case 'PUBLISHER_REQUIRED':
      return 'Register the workspace as a publisher first: in your PhiWebs account, or with the register_publisher tool (pwf mcp, signed in). PhiWebs approves a publisher before its packs are listed.'
    case 'PUBLISHER_NOT_APPROVED':
      return 'The workspace publisher is not approved yet. Publish again once PhiWebs has approved it (get_publisher shows its state).'
    case 'SESSION_REFUSED':
    case 'UNAUTHORIZED':
      return 'Run `pwf login` to sign in again.'
    case 'INSUFFICIENT_SCOPE':
    case 'FORBIDDEN':
      return 'Run `pwf login` again and approve publishing packs (marketplace:publish); only workspace editors, admins and owners may publish.'
    case 'VERSION_EXISTS':
    case 'VERSION_ALREADY_PUBLISHED':
    case 'CONFLICT':
      return 'This version is published already: raise "version" in pwpack.json, then publish again.'
    case 'SLUG_TAKEN':
    case 'SLUG_OWNED_BY_OTHER':
      return 'Another publisher owns this pack id. Use an id under your own publisher handle (@pwpack/<handle>/<name>).'
    case 'UNKNOWN_REQUIRES':
    case 'REQUIRES_UNKNOWN':
      return 'The pack requires a pack the marketplace does not have. Publish that one first, or remove the requirement.'
    case 'API_UNREACHABLE':
      return 'Nothing was published. Try again in a moment.'
    default:
      if (/LIMIT|TOO_LARGE/i.test(code)) return 'The pack is over a size limit; the message says which. Make it smaller and publish again.'
      return 'Read the message, fix what it says, and publish again.'
  }
}

export function marketplaceFailure(code: string, message: string): CommandFailure {
  return new CommandFailure(code, message, { lines: [`${code}: ${message}`, `fix: ${marketplaceFix(code)}`] })
}

async function request(options: MarketplaceOptions, method: string, path: string, body?: FormData): Promise<{ status: number; body: Record<string, unknown> }> {
  let res: Response
  try {
    res = await (options.fetch ?? fetch)(`${options.server}${path}`, {
      method,
      headers: { authorization: `Bearer ${options.accessToken}`, accept: 'application/json' },
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    throw marketplaceFailure('API_UNREACHABLE', `cannot reach ${options.server}: ${(e as Error).message}`)
  }
  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = JSON.parse(text)
  } catch {
    // not JSON
  }
  const b = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  if (res.status === 401) throw marketplaceFailure('SESSION_REFUSED', `${options.server} no longer accepts the saved session`)
  if (res.ok) return { status: res.status, body: b }
  if (res.status === 404 && path === MARKETPLACE_PATHS.publisher) return { status: 404, body: b }
  const err = b['error'] && typeof b['error'] === 'object' ? (b['error'] as Record<string, unknown>) : b
  const challenge = res.headers.get('www-authenticate') ?? ''
  const code =
    res.status === 403 && /insufficient_scope/.test(challenge)
      ? 'INSUFFICIENT_SCOPE'
      : typeof err['code'] === 'string'
        ? err['code']
        : typeof b['error'] === 'string'
          ? b['error']
          : `HTTP_${res.status}`
  const message =
    typeof err['message'] === 'string' ? err['message'] : typeof b['error_description'] === 'string' ? b['error_description'] : `${method} ${path} answered HTTP ${res.status}`
  throw marketplaceFailure(code, message)
}

/** What a marketplace publish answered. */
export interface PackPublished {
  readonly id: string
  readonly version: string
  readonly listingId: string
  /** The version's state (staged until reviewed). */
  readonly state: string
  /** The listing's state (draft, pending review, approved, …). */
  readonly listingStatus: string
  readonly publisher: string
  /** Warnings and notes of the review the API ran on publish. */
  readonly reviewFindings: readonly PackIssue[]
  readonly warnings: readonly PackIssue[]
  readonly file: string
  readonly bytes: number
}

function findings(value: unknown): PackIssue[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map((f) => ({
      severity: f['severity'] === 'error' || f['severity'] === 'info' ? f['severity'] : 'warning',
      code: typeof f['code'] === 'string' ? f['code'] : 'REVIEW',
      message: typeof f['message'] === 'string' ? f['message'] : '',
      ...(typeof f['path'] === 'string' ? { path: f['path'] } : {}),
    }))
}

/**
 * Publishes the pack folder at `root` to the marketplace for review, as the
 * workspace's publisher. Refuses an app folder (that is `pwf publish`'s studio
 * route) and a workspace without an approved publisher, before packing.
 */
export async function publishPackFolder(root: string, options: MarketplaceOptions): Promise<PackPublished> {
  const identity = await readIdentityFile(root)
  if (identity['app'] !== undefined) {
    throw new CommandFailure('NOT_A_PACK', `${root} is an app; publishing to the marketplace is for packs`, {
      lines: [`NOT_A_PACK: ${root} is an app.`, 'fix: Publish an app with `pwf publish` (the studio route); pwf_publish_pack is for pack folders.'],
    })
  }
  const pub = await request(options, 'GET', MARKETPLACE_PATHS.publisher)
  const publisher = pub.body['data'] && typeof pub.body['data'] === 'object' ? (pub.body['data'] as Record<string, unknown>) : null
  if (pub.status === 404 || !publisher) throw marketplaceFailure('PUBLISHER_REQUIRED', 'this workspace is not registered as a publisher')
  const status = typeof publisher['status'] === 'string' ? publisher['status'] : 'unknown'
  if (status !== 'approved') throw marketplaceFailure('PUBLISHER_NOT_APPROVED', `the workspace publisher is ${status}, not approved`)
  const publisherName = typeof publisher['handle'] === 'string' ? publisher['handle'] : typeof publisher['name'] === 'string' ? publisher['name'] : String(publisher['id'] ?? '')

  const id = String(identity['id'])
  const version = String(identity['version'])
  const packed = await packProject(root, join(root, PWF_DIR, 'publish', archiveName(id, version)))
  const bytes = new Uint8Array(await readFile(packed.file))
  // The manifest describes exactly these bytes; its id is the folder's, as written.
  const manifest = deriveManifest(packContent(await readProject(root)), { archive: bytes })
  const form = new FormData()
  form.set('file', new Blob([bytes], { type: 'application/gzip' }), basename(packed.file))
  form.set('manifest', JSON.stringify(manifest))
  form.set('scope', 'marketplace')
  const res = await request(options, 'POST', MARKETPLACE_PATHS.publish, form)
  const data = (res.body['data'] && typeof res.body['data'] === 'object' ? res.body['data'] : {}) as Record<string, unknown>
  return {
    id: manifest.id,
    version: typeof data['version'] === 'string' ? data['version'] : manifest.version,
    listingId: typeof data['listingId'] === 'string' ? data['listingId'] : '',
    state: typeof data['state'] === 'string' ? data['state'] : 'staged',
    listingStatus: typeof data['listingStatus'] === 'string' ? data['listingStatus'] : 'pending',
    publisher: publisherName,
    reviewFindings: findings(data['reviewFindings']),
    warnings: packed.warnings,
    file: packed.file,
    bytes: packed.bytes,
  }
}

/** The lines that say where a published pack stands. */
export function packPublishedLines(p: PackPublished): string[] {
  return [
    `Sent ${p.id}@${p.version} to the PhiWebs marketplace as ${p.publisher || 'your publisher'}`,
    `  listing  ${p.listingId} (${p.listingStatus})`,
    `  version  ${p.version} (${p.state})`,
    p.listingStatus === 'approved' || p.state === 'current'
      ? 'It is listed; workspaces install it from the marketplace.'
      : 'PhiWebs reviews it before it is listed; get_listing shows the review state.',
  ]
}
