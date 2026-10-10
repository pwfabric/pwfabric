/**
 * Reading and writing a project's `pwpack.json`: stable key order, pins and
 * requirements, and the engine range a new project declares.
 */
import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The order `pwpack.json` members are written in. Members not listed follow, in their original order. */
export const IDENTITY_KEY_ORDER = ['id', 'version', 'formatVersion', 'engines', 'requires', 'license', 'app', 'packs'] as const

export const IDENTITY_FILE = 'pwpack.json'

export type IdentityJson = Record<string, unknown>

export interface PackPin {
  readonly id: string
  readonly version: string
  readonly hash: string
}

/** A copy of `doc` with its members in {@link IDENTITY_KEY_ORDER}. */
export function orderIdentity(doc: IdentityJson): IdentityJson {
  const out: IdentityJson = {}
  for (const key of IDENTITY_KEY_ORDER) if (doc[key] !== undefined) out[key] = doc[key]
  for (const [key, value] of Object.entries(doc)) if (!(key in out) && value !== undefined) out[key] = value
  return out
}

/** The JSON text of `pwpack.json`: ordered members, two-space indent, trailing newline. */
export function formatIdentity(doc: IdentityJson): string {
  return `${JSON.stringify(orderIdentity(doc), null, 2)}\n`
}

/** Two-space JSON with a trailing newline, the format of every file the commands write. */
export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export async function readIdentityFile(root: string): Promise<IdentityJson> {
  const text = await readFile(join(root, IDENTITY_FILE), 'utf8').catch(() => null)
  if (text === null) throw new Error(`${join(root, IDENTITY_FILE)} not found; run this inside a pwpack folder or pass --dir`)
  let value: unknown
  try {
    value = JSON.parse(stripBom(text))
  } catch (e) {
    throw new Error(`${IDENTITY_FILE} is not JSON: ${(e as Error).message}`)
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${IDENTITY_FILE} is not a JSON object`)
  return value as IdentityJson
}

export async function writeIdentityFile(root: string, doc: IdentityJson): Promise<void> {
  await writeFile(join(root, IDENTITY_FILE), formatIdentity(doc))
}

/** `^<major>.0.0` for a semver version — the range a requirement on that build declares. */
export function caretRange(version: string): string {
  const major = /^(\d+)\./.exec(version)?.[1]
  if (major === undefined) throw new Error(`"${version}" is not a semver version`)
  return `^${major}.0.0`
}

/** Adds the pin, or replaces the pin with the same id. Order of the others is kept. */
export function upsertPin(doc: IdentityJson, pin: PackPin): void {
  const pins = Array.isArray(doc.packs) ? [...(doc.packs as unknown[])] : []
  const entry = { id: pin.id, version: pin.version, hash: pin.hash }
  const at = pins.findIndex((p) => p !== null && typeof p === 'object' && (p as { id?: unknown }).id === pin.id)
  if (at >= 0) pins[at] = entry
  else pins.push(entry)
  doc.packs = pins
}

/** Adds `{ id, range }` to `requires`, or updates the entry (object or bare name) for that id. */
export function upsertRequirement(doc: IdentityJson, id: string, range: string): void {
  const list = Array.isArray(doc.requires) ? [...(doc.requires as unknown[])] : []
  const at = list.findIndex((r) => r === id || (r !== null && typeof r === 'object' && (r as { id?: unknown }).id === id))
  const entry = { id, range }
  if (at >= 0) list[at] = entry
  else list.push(entry)
  doc.requires = list
}

/** Pins listed in a parsed `pwpack.json`. */
export function pinsOf(doc: { readonly packs?: readonly PackPin[] } | null): readonly PackPin[] {
  return doc?.packs ?? []
}

/**
 * Finds `node_modules/<name>/package.json` the way Node resolves a bare
 * import, walking up from `fromDir`. Returns null when it is not installed.
 */
export function findPackageJson(name: string, fromDir: string): string | null {
  let dir = fromDir
  for (;;) {
    const candidate = join(dir, 'node_modules', ...name.split('/'), 'package.json')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

const CONTRACTS_PACKAGE = '@pwfabric/contracts'

/** The engine version this command line runs with: the contracts package's version. */
export function engineVersion(fromDir: string = dirname(fileURLToPath(import.meta.url))): string {
  const path = findPackageJson(CONTRACTS_PACKAGE, fromDir)
  if (!path) throw new Error(`cannot find ${CONTRACTS_PACKAGE}; reinstall pwf`)
  const { version } = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown }
  if (typeof version !== 'string') throw new Error(`${path} has no version`)
  return version
}

/** `>=<major>.<minor> <<major+1>`: this engine's release and every later one before the next major. */
export function engineRange(version: string): string {
  const m = /^(\d+)\.(\d+)\./.exec(version)
  if (!m) throw new Error(`engine version "${version}" is not semver`)
  return `>=${m[1]}.${m[2]} <${Number(m[1]) + 1}`
}

/** Text without a leading byte-order mark. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}
