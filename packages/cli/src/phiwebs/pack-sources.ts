/**
 * A pack from PhiWebs for local work: `pwf add @pwpack/<handle>/<name>`. The
 * API lists the packs the signed-in workspace may use on this computer (its
 * installs whose source it may read), each with a download address and the
 * sha256 of its bytes; the rest are listed as skipped, with the reason. A
 * download address on the API's own origin takes the session's token, as the
 * listing does; one anywhere else carries its own authorization (a presigned
 * address) and gets no token. The bytes are checked against that sha256
 * before anything is installed. Neither the address nor the token is ever
 * printed.
 */
import { sha256Hex } from '@pwfabric/pack'
import { CommandFailure } from '../commands/lib/failure.js'
import type { Fetch } from './oauth.js'

/** The API route (scope `marketplace:read`). */
export const PACK_SOURCES_PATH = '/api/pwpacks/sources'

const TIMEOUT_MS = 5 * 60_000

/** `@pwpack/<handle>/<name>` with an optional `@<version>`; handle and name kebab-case. */
const PACK_REF = /^(@pwpack\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)(?:@([0-9A-Za-z.+-]+))?$/

export interface PackRef {
  readonly id: string
  readonly version?: string
}

/** The pack id (and version) an argument names, or null when it is not one. */
export function parsePackRef(arg: string): PackRef | null {
  const m = PACK_REF.exec(arg)
  if (!m) return null
  return { id: m[1] as string, ...(m[2] ? { version: m[2] } : {}) }
}

export interface PackSourceOptions {
  /** The API. */
  readonly server: string
  /** An API-audience access token. */
  readonly accessToken: string
  /**
   * A new access token for the API, refreshed even when the saved one has not
   * expired: asked for once when a download on the API's own origin answers 401.
   */
  readonly refresh?: () => Promise<string>
  readonly fetch?: Fetch
}

/** A downloaded pack, its bytes checked. */
export interface PackSource {
  readonly id: string
  readonly version: string
  readonly sha256: string
  readonly bytes: Uint8Array
}

const STUDIO = 'https://studio.phiwebs.com'

/** Why the API did not offer a pack, in plain words, and what to do. */
const SKIPPED: Readonly<Record<string, { code: string; why: string; fix: string }>> = {
  pattern_pack: {
    code: 'PACK_PATTERNS_ONLY',
    why: 'it holds patterns only, which PhiWebs keeps on the server',
    fix: `Use it in the PhiWebs studio (${STUDIO}); a pattern pack is not given out for local work.`,
  },
  source_not_licensed: {
    code: 'PACK_NOT_LICENSED',
    why: "the workspace's licence for it does not include its source",
    fix: `Use it in the PhiWebs studio (${STUDIO}), or get a licence that includes the source from its marketplace listing.`,
  },
  source_not_stored: {
    code: 'PACK_SOURCE_NOT_STORED',
    why: 'PhiWebs holds no source for this version',
    fix: 'Try again later, or ask its publisher to publish the version again.',
  },
  listing_missing: {
    code: 'PACK_LISTING_MISSING',
    why: 'its marketplace listing is gone',
    fix: 'Install a pack that is listed in the PhiWebs marketplace instead.',
  },
  hash_changed: {
    code: 'PACK_SOURCE_CHANGED',
    why: 'the stored source no longer matches the version the workspace installed',
    fix: 'Try again later; if it stays so, tell the pack publisher.',
  },
}

/** What to do about a refusal, by its code. */
export function packSourceFix(code: string): string {
  const skipped = Object.values(SKIPPED).find((s) => s.code === code)
  if (skipped) return skipped.fix
  switch (code) {
    case 'NOT_SIGNED_IN':
      return 'Run `pwf login` to sign in to PhiWebs, then add the pack again.'
    case 'SESSION_REFUSED':
    case 'SESSION_EXPIRED':
    case 'UNAUTHORIZED':
      return 'Run `pwf login` to sign in again.'
    case 'INSUFFICIENT_SCOPE':
    case 'FORBIDDEN':
      return 'Run `pwf login` again and approve reading the marketplace (marketplace:read).'
    case 'NO_WORKSPACE':
      return 'Run `pwf login` again and choose a workspace when you sign in.'
    case 'PACK_NOT_INSTALLED':
      return 'Install it in your PhiWebs workspace from the marketplace first (or check the id and version), then add it again.'
    case 'PACK_HASH_MISMATCH':
    case 'PACK_DOWNLOAD_FAILED':
    case 'API_UNREACHABLE':
      return 'Nothing was installed. Try again in a moment.'
    default:
      return 'Read the message, fix what it says, and add the pack again.'
  }
}

export function packSourceFailure(code: string, message: string): CommandFailure {
  return new CommandFailure(code, message, { lines: [`${code}: ${message}`, `fix: ${packSourceFix(code)}`] })
}

interface Listed {
  readonly id: string
  readonly version: string
}

function listedOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && typeof (v as Listed).id === 'string' && typeof (v as Listed).version === 'string') : []
}

async function sources(options: PackSourceOptions): Promise<{ packs: Record<string, unknown>[]; skipped: Record<string, unknown>[] }> {
  let res: Response
  try {
    res = await (options.fetch ?? fetch)(`${options.server}${PACK_SOURCES_PATH}`, {
      headers: { authorization: `Bearer ${options.accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    throw packSourceFailure('API_UNREACHABLE', `cannot reach ${options.server}: ${(e as Error).message}`)
  }
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>
  } catch {
    // not JSON
  }
  if (res.status === 401) throw packSourceFailure('SESSION_REFUSED', `${options.server} no longer accepts the saved session`)
  if (!res.ok) {
    const err = body['error'] && typeof body['error'] === 'object' ? (body['error'] as Record<string, unknown>) : {}
    const code =
      res.status === 403 && /insufficient_scope/.test(res.headers.get('www-authenticate') ?? '')
        ? 'INSUFFICIENT_SCOPE'
        : typeof err['code'] === 'string'
          ? err['code']
          : `HTTP_${res.status}`
    throw packSourceFailure(code, typeof err['message'] === 'string' ? err['message'] : `${PACK_SOURCES_PATH} answered HTTP ${res.status}`)
  }
  const data = body['data'] && typeof body['data'] === 'object' ? (body['data'] as Record<string, unknown>) : {}
  return { packs: listedOf(data['packs']), skipped: listedOf(data['skipped']) }
}

/**
 * The bytes at `url`. An address on the API's own origin is an API route and
 * takes the session's token (refreshed once after a 401); any other is
 * presigned and gets none. A plain-http address is refused unless the API
 * itself is http (local development).
 */
async function download(url: string, name: string, options: PackSourceOptions): Promise<Uint8Array> {
  let target: URL
  let api: URL
  try {
    target = new URL(url)
    api = new URL(options.server)
  } catch {
    throw packSourceFailure('PACK_DOWNLOAD_FAILED', `PhiWebs gave no usable download for ${name}`)
  }
  const secure = target.protocol === 'https:' || (target.protocol === 'http:' && api.protocol === 'http:')
  if (!secure) throw packSourceFailure('PACK_DOWNLOAD_FAILED', `PhiWebs gave no usable download for ${name}: not an https address`)
  const own = target.origin === api.origin
  const get = async (token: string | undefined): Promise<Response> => {
    try {
      return await (options.fetch ?? fetch)(target.href, {
        ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw packSourceFailure('PACK_DOWNLOAD_FAILED', `the download of ${name} did not complete`)
    }
  }
  let res = await get(own ? options.accessToken : undefined)
  if (own && res.status === 401 && options.refresh) {
    let token: string
    try {
      token = await options.refresh()
    } catch (e) {
      if (e instanceof CommandFailure) throw packSourceFailure(e.code, e.message)
      throw e
    }
    res = await get(token)
  }
  if (!res.ok) {
    if (own && (res.status === 401 || res.status === 403)) throw packSourceFailure('SESSION_REFUSED', `${options.server} refused the download of ${name} with the saved session`)
    if (res.status === 404) throw packSourceFailure('PACK_NOT_INSTALLED', `the download of ${name} was not found in your PhiWebs workspace`)
    throw packSourceFailure('PACK_DOWNLOAD_FAILED', `the download of ${name} answered HTTP ${res.status}`)
  }
  try {
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    throw packSourceFailure('PACK_DOWNLOAD_FAILED', `the download of ${name} did not complete`)
  }
}

const label = (ref: PackRef): string => (ref.version ? `${ref.id}@${ref.version}` : ref.id)

/**
 * Downloads the pack `ref` names from the signed-in workspace's pack sources
 * and checks its bytes against the sha256 the API gave. A pack the API skips
 * fails with a code for its reason; one it does not list fails with
 * PACK_NOT_INSTALLED.
 */
export async function downloadPackSource(ref: PackRef, options: PackSourceOptions): Promise<PackSource> {
  const { packs, skipped } = await sources(options)
  const matches = (p: Record<string, unknown>): boolean => p['id'] === ref.id && (ref.version === undefined || p['version'] === ref.version)
  const offered = packs.find(matches)
  if (!offered) {
    const skip = skipped.find(matches)
    if (skip) {
      const known = SKIPPED[String(skip['reason'])]
      const name = `${ref.id}@${String(skip['version'])}`
      if (known) throw packSourceFailure(known.code, `${name} cannot be used locally: ${known.why}`)
      throw packSourceFailure('PACK_NOT_AVAILABLE', `${name} cannot be used locally (${String(skip['reason'])})`)
    }
    const other = [...packs, ...skipped].filter((p) => p['id'] === ref.id).map((p) => String(p['version']))
    throw packSourceFailure(
      'PACK_NOT_INSTALLED',
      other.length
        ? `your PhiWebs workspace has ${ref.id} at ${other.join(', ')}, not ${ref.version}`
        : `${label(ref)} is not installed in your PhiWebs workspace`
    )
  }
  const version = String(offered['version'])
  const sha256 = String(offered['sha256'] ?? '').toLowerCase()
  const name = `${ref.id}@${version}`
  const url = offered['downloadUrl']
  if (typeof url !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
    throw packSourceFailure('PACK_DOWNLOAD_FAILED', `PhiWebs gave no usable download for ${name}`)
  }
  const bytes = await download(url, name, options)
  const got = sha256Hex(bytes)
  if (got !== sha256) throw packSourceFailure('PACK_HASH_MISMATCH', `the downloaded ${name} has sha256 ${got}, not the ${sha256} PhiWebs gave`)
  return { id: ref.id, version, sha256, bytes }
}
