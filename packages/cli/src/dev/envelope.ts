/**
 * The envelope documents a runner reads (`pwpack/project.json`,
 * `navigation.json`, `connections.json`, the two module manifests), built
 * from the app folder's declaration.
 */
import { registrationOf, type DynamicBlockProp, type IdentityRegistration, type PropShape } from '@pwfabric/contracts'
import { blockPropDescriptors } from '@pwfabric/pack'
import type { AssembleDiagnostic } from './diagnostics.js'
import { isRecord } from './sources.js'

/** One page of the app: its key, its receipt and what the receipt says. */
export interface Page {
  readonly key: string
  /** Path of the receipt in the app folder. */
  readonly path: string
  readonly bytes: Uint8Array
  readonly receipt: Record<string, unknown>
}

/** The block types a receipt places, walking `blocks` and every `children`. */
export function blockTypesOf(receipt: unknown): string[] {
  const types = new Set<string>()
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (!isRecord(node)) return
    if (typeof node['type'] === 'string' && node['type']) types.add(node['type'])
    if (Array.isArray(node['children'])) node['children'].forEach(walk)
  }
  if (isRecord(receipt)) walk(receipt['blocks'])
  return [...types]
}

/** The page's display name: the receipt's title, else the key. */
export function pageLabel(page: Page): string {
  const title = page.receipt['title']
  return typeof title === 'string' && title.trim() ? title.trim() : page.key
}

/** Navigation derived from the route table when the app declares none. */
export function deriveNavigation(pages: readonly Page[], entry: string): { navbar: { links: { label: string; href: string }[] } } {
  return {
    navbar: { links: pages.map((p) => ({ label: pageLabel(p), href: p.key === entry ? '/' : `/${p.key}` })) },
  }
}

/**
 * What the app declares about who may enter (`app/definitions/auth.json`), as `project.json` carries it.
 * A file that says nothing about entry (only `access`) is no identity: the app has no door and no wall.
 */
export function identityOf(
  auth: unknown
): { required: boolean; topology: 'app' | 'external'; methods?: string[]; registration: IdentityRegistration } | undefined {
  if (!isRecord(auth)) return undefined
  const topology = auth['topology'] === 'external' ? 'external' : 'app'
  const methods = Array.isArray(auth['methods']) ? auth['methods'].filter((m): m is string => typeof m === 'string') : []
  if (topology === 'app' && methods.length === 0 && auth['required'] !== true) return undefined
  return {
    required: auth['required'] === true,
    topology,
    ...(topology === 'app' ? { methods } : {}),
    // The first frame's `__auth.registration` (pwapp-format §2.5): the build
    // has no `auth.json` to read it from.
    registration: registrationOf(auth),
  }
}

export interface ProjectJsonInput {
  readonly id: string
  readonly title: string
  readonly entry: string
  readonly pages: readonly Page[]
  /** The app's own not-found page (`app.notFound`), when it declares one. */
  readonly notFound?: Page | undefined
  /** The app's own sign-in screen (`app.signIn`), when it declares one. */
  readonly signIn?: Page | undefined
  readonly auth?: unknown
  /** `app/plan.json` `locale` (BCP 47): what the runtime writes dates and numbers in. */
  readonly locale?: string
  /** `app/plan.json` `messages`: the app's words, id → string (envelope §2). */
  readonly messages?: Readonly<Record<string, string>>
}

/** `pwpack/project.json`. */
export function buildProjectJson(input: ProjectJsonInput): Record<string, unknown> {
  const surfaceReceiptFiles: Record<string, string> = {}
  for (const p of input.pages) surfaceReceiptFiles[p.key] = `surfaces/${p.key}.receipt.json`
  for (const off of [input.notFound, input.signIn]) {
    if (off) surfaceReceiptFiles[off.key] = `surfaces/${off.key}.receipt.json`
  }
  const identity = identityOf(input.auth)
  return {
    schemaVersion: '1.0.0',
    id: input.id,
    ...(input.title ? { title: input.title } : {}),
    ...(input.locale ? { locale: input.locale } : {}),
    ...(input.messages && Object.keys(input.messages).length > 0 ? { messages: input.messages } : {}),
    entrySurfaceId: input.entry,
    surfaceOrder: input.pages.map((p) => p.key),
    surfaceReceiptFiles,
    ...(input.notFound ? { notFoundSurfaceId: input.notFound.key } : {}),
    ...(input.signIn ? { signInSurfaceId: input.signIn.key } : {}),
    ...(identity ? { identity } : {}),
  }
}

/** Config keys that smell of a credential. Such a key never reaches a published app. */
export const CREDENTIAL_KEY_RE =
  /(auth|header|credential|secret|token|password|passwd|apikey|api_key|clientsecret|client_secret|bearer|cookie|signature)/i

function stripCredentials(value: unknown, path: string, dropped: string[]): unknown {
  if (Array.isArray(value)) return value.map((v, i) => stripCredentials(v, `${path}[${i}]`, dropped))
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    if (CREDENTIAL_KEY_RE.test(k)) {
      dropped.push(`${path}.${k}`)
      continue
    }
    out[k] = stripCredentials(v, `${path}.${k}`, dropped)
  }
  return out
}

/**
 * `pwpack/connections.json`: the declaration with every credential-like
 * config key removed (each removal is reported). A bare string entry is read
 * as `{ name }`.
 */
export function buildConnections(
  doc: unknown,
  diagnostics: AssembleDiagnostic[],
  path = 'app/definitions/connections.json'
): { connections: Record<string, unknown>[] } | undefined {
  if (!isRecord(doc)) return undefined
  const list = Array.isArray(doc['connections']) ? doc['connections'] : []
  const connections: Record<string, unknown>[] = []
  for (const raw of list) {
    const entry = typeof raw === 'string' ? { name: raw } : isRecord(raw) ? raw : null
    if (!entry || typeof entry['name'] !== 'string') {
      diagnostics.push({ severity: 'warning', code: 'CONNECTION_INVALID', message: 'a connection without a name is skipped', path })
      continue
    }
    const dropped: string[] = []
    const out: Record<string, unknown> = { ...entry }
    if (entry['config'] !== undefined) out['config'] = stripCredentials(entry['config'], 'config', dropped)
    for (const d of dropped) {
      diagnostics.push({
        severity: 'warning',
        code: 'CREDENTIAL_DROPPED',
        message: `connection "${entry['name']}": ${d} looks like a credential and is not published`,
        path,
      })
    }
    connections.push(out)
  }
  return { connections }
}

/** One entry of `blocks/manifest.json`. */
export interface BlockManifestEntry {
  readonly blockType: string
  readonly moduleUrl: string
  readonly integrity: string
  readonly publisher: string
  readonly publisherVerified: boolean
  /**
   * `props`: the props the block's manifest declares — name, `bindable`,
   * `required`, `default` and shape (`jsonSchema`, without its prose) — which
   * the renderer applies before the block renders. Absent when the manifest
   * declares no props.
   */
  readonly definition: { readonly name: string; readonly props?: readonly DynamicBlockProp[] }
}

/** Shape members for people and tools only: a visitor's page does not need them. */
const PROSE = new Set(['description', 'title', 'examples', '$schema'])

function withoutProse(shape: unknown): unknown {
  if (Array.isArray(shape)) return shape.map(withoutProse)
  if (!isRecord(shape)) return shape
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(shape)) {
    if (PROSE.has(k)) continue
    // `default`, `enum` and `const` are values, not shapes: copied as written.
    out[k] = k === 'default' || k === 'enum' || k === 'const' ? v : k === 'properties' && isRecord(v) ? Object.fromEntries(Object.entries(v).map(([n, s]) => [n, withoutProse(s)])) : withoutProse(v)
  }
  return out
}

/**
 * The props a block manifest declares, as `blocks/manifest.json` carries
 * them: what the renderer reads (`applyBlockProps`) — `name`, `bindable`,
 * `required`, `default` and `jsonSchema` — and nothing written for people
 * (`type`, `description`, `copy`). A descriptor without a name is skipped
 * (the validator reports it). `undefined` when the manifest declares no props.
 */
export function manifestProps(manifest: unknown): DynamicBlockProp[] | undefined {
  return blockPropDescriptors(manifest)?.map((p) => {
    const d = p as unknown as Record<string, unknown>
    return {
      name: p.name,
      ...(typeof d['bindable'] === 'boolean' ? { bindable: d['bindable'] } : {}),
      ...(d['required'] === true ? { required: true } : {}),
      ...(d['default'] !== undefined ? { default: d['default'] } : {}),
      ...(isRecord(d['jsonSchema']) ? { jsonSchema: withoutProse(d['jsonSchema']) as PropShape } : {}),
    }
  })
}

/** One entry of `engines/manifest.json`. */
export interface EngineManifestEntry {
  readonly connection: string
  readonly atomId: string
  readonly kind: 'connector' | 'provider'
  readonly moduleUrl?: string
  readonly integrity?: string
  readonly engine?: unknown
}

/** A file name for a module: `<name>.<first 8 hex of its hash>.mjs`, with anything unsafe replaced. */
export function moduleFileName(name: string, hexHash: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '_') || 'module'
  return `${safe}.${hexHash.slice(0, 8)}.mjs`
}

/** The publisher an atom is attributed to: the pack id's publisher segment, or the id itself. */
export function publisherOf(packId: string): string {
  const m = /^@pwpack\/([^/]+)\//.exec(packId)
  return m?.[1] ?? packId
}

/**
 * Whether a local host may write `name` into the envelope: a relative path of
 * `/`-separated segments ending in `.json` (`auth.json`,
 * `surfaces/home.receipt.json`), each segment starting with a letter, digit,
 * `_` or `-` — so no `.`/`..` segment, no hidden file, no absolute path.
 */
export function isEnvelopeFileName(name: string): boolean {
  return /^(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.json$/.test(name)
}

/**
 * Merges what a local host adds to the envelope. Each key is a file name
 * relative to `pwpack/` (`auth.json`, `surfaces/<key>.receipt.json`) and each
 * value the document; a value for `project.json` is merged into it member by
 * member. Called after the static envelope is laid out, so what the host
 * offers WINS: its receipts (entity sources rewritten to its record
 * endpoints) replace the folder's copies.
 */
export function mergeEnvelopeEntries(
  files: Map<string, Uint8Array>,
  entries: Readonly<Record<string, unknown>> | undefined,
  diagnostics: AssembleDiagnostic[]
): void {
  if (!entries) return
  const enc = new TextEncoder()
  for (const [name, value] of Object.entries(entries)) {
    if (!isEnvelopeFileName(name)) {
      diagnostics.push({ severity: 'warning', code: 'HOST_ENTRY_IGNORED', message: `the local host offered "${name}", which is not an envelope file name` })
      continue
    }
    const path = `pwpack/${name}`
    if (name === 'project.json' && isRecord(value)) {
      const current = JSON.parse(new TextDecoder().decode(files.get(path) as Uint8Array)) as Record<string, unknown>
      files.set(path, enc.encode(JSON.stringify({ ...current, ...value })))
      continue
    }
    files.set(path, enc.encode(JSON.stringify(value)))
  }
}
