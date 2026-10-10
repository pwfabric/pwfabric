/**
 * Reading what an app is made of: the app folder itself and every pack build
 * its `pwpack.json` pins, from the project's local cache
 * (`.pwf/packs/<id>@<version>/`, written by `pwf create` / `pwf add`).
 *
 * Nothing here fetches: a pin that is not in the cache is a diagnostic that
 * says which command fills it.
 */
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AtomRef, PwpackIdentity } from '@pwfabric/contracts'
import {
  DEFAULT_IGNORED_NAMES,
  PackError,
  isSafePackPath,
  packContent,
  readFolder,
  validatePack,
  type PackFolder,
  type PackValidation,
} from '@pwfabric/pack'
import type { AssembleDiagnostic } from './diagnostics.js'

/** The project's working folder; never part of the app. */
export const PWF_DIR = '.pwf'
/** Names skipped when the app folder is read. */
export const APP_IGNORED_NAMES: ReadonlySet<string> = new Set([...DEFAULT_IGNORED_NAMES, PWF_DIR])

/** One folder the assembler reads atoms from: the app itself or a pinned pack build. */
export interface SourcePack {
  readonly origin: 'app' | 'pack'
  readonly id: string
  readonly version: string
  /** The pin's hash, when the app pinned one. */
  readonly pinnedHash?: string
  /** Absolute folder. */
  readonly dir: string
  /** Path of `dir` as diagnostics print it (relative to the app root). */
  readonly label: string
  readonly folder: PackFolder
  readonly validation: PackValidation
}

export interface LoadedSources {
  readonly app: SourcePack | null
  readonly identity: PwpackIdentity | null
  /** The pinned packs, in pin order (the app's own atoms are in `app`). */
  readonly packs: readonly SourcePack[]
  readonly diagnostics: readonly AssembleDiagnostic[]
}

/** `.pwf/packs/<id>@<version>` as a POSIX path relative to the app root. */
export function packCacheRel(id: string, version: string): string | null {
  const rel = `${id}@${version}`
  if (!isSafePackPath(rel) || /[<>:"|?*]/.test(rel)) return null
  return `${PWF_DIR}/packs/${rel}`
}

async function isDir(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isDirectory() === true
}

function issuesToDiagnostics(
  validation: PackValidation,
  label: string,
  downgrade: boolean
): AssembleDiagnostic[] {
  return validation.issues
    .filter((i) => i.severity !== 'info')
    .map((i) => ({
      severity: downgrade && i.severity === 'error' ? 'warning' : i.severity,
      code: i.code,
      message: i.message,
      ...(i.path !== undefined ? { path: label ? `${label}/${i.path}` : i.path } : {}),
    }))
}

function packDiagnostics(source: SourcePack, pin: { id: string; version: string }): AssembleDiagnostic[] {
  const out = issuesToDiagnostics(source.validation, source.label, true)
  const cached = source.validation.identity
  if (cached && (cached.id !== pin.id || cached.version !== pin.version)) {
    out.push({
      severity: 'warning',
      code: 'PACK_IDENTITY_MISMATCH',
      message: `${source.label}/pwpack.json says ${cached.id}@${cached.version}, the pin says ${pin.id}@${pin.version}`,
      path: `${source.label}/pwpack.json`,
    })
  }
  return out
}

async function readSource(dir: string, ignore: ReadonlySet<string>): Promise<PackFolder | string> {
  try {
    return await readFolder(dir, { ignore })
  } catch (e) {
    if (e instanceof PackError) return `${e.code}: ${e.message}`
    throw e
  }
}

/**
 * Pack builds already read, by absolute folder. A cached build is immutable
 * (`<id>@<version>`), so a dev session reads each once and forgets it only
 * when the watcher sees its folder change.
 */
export type PackMemo = Map<string, SourcePack>

/** Reads the app at `root` and every pack build it pins. */
export async function loadSources(root: string, memo?: PackMemo): Promise<LoadedSources> {
  const diagnostics: AssembleDiagnostic[] = []
  const read = await readSource(root, APP_IGNORED_NAMES)
  if (typeof read === 'string') {
    diagnostics.push({ severity: 'error', code: 'APP_UNREADABLE', message: read })
    return { app: null, identity: null, packs: [], diagnostics }
  }
  // The app is its pack content: the `.gitignore` that `pwf create` writes,
  // editor dotfiles and the author's tooling are not part of it, so a build
  // neither reads nor warns about them (`pwf validate` still lists tooling).
  const appFolder = packContent(read)
  const appValidation = validatePack(appFolder)
  diagnostics.push(...issuesToDiagnostics(appValidation, '', false))
  const identity = appValidation.identity
  if (!identity) {
    if (!diagnostics.some((d) => d.severity === 'error')) {
      diagnostics.push({ severity: 'error', code: 'IDENTITY_MISSING', message: 'pwpack.json is missing or invalid', path: 'pwpack.json' })
    }
    return { app: null, identity: null, packs: [], diagnostics }
  }
  const app: SourcePack = {
    origin: 'app',
    id: identity.id,
    version: identity.version,
    dir: root,
    label: '',
    folder: appFolder,
    validation: appValidation,
  }

  const packs: SourcePack[] = []
  for (const pin of identity.packs ?? []) {
    const rel = packCacheRel(pin.id, pin.version)
    if (!rel) {
      diagnostics.push({
        severity: 'error',
        code: 'PIN_INVALID',
        message: `pack "${pin.id}" version "${pin.version}" cannot name a cache folder`,
        path: 'pwpack.json',
      })
      continue
    }
    const dir = join(root, ...rel.split('/'))
    const remembered = memo?.get(dir)
    if (remembered) {
      diagnostics.push(...packDiagnostics(remembered, pin))
      packs.push({ ...remembered, pinnedHash: pin.hash })
      continue
    }
    if (!(await isDir(dir))) {
      diagnostics.push({
        severity: 'error',
        code: 'PACK_NOT_CACHED',
        message: `${pin.id}@${pin.version} is pinned in pwpack.json but is not in ${rel}/ — run \`pwf add ${pin.id}@${pin.version}\` (or recreate the app with \`pwf create\`) to put it there`,
        path: 'pwpack.json',
      })
      continue
    }
    const folder = await readSource(dir, DEFAULT_IGNORED_NAMES)
    if (typeof folder === 'string') {
      diagnostics.push({ severity: 'error', code: 'PACK_UNREADABLE', message: folder, path: rel })
      continue
    }
    const source: SourcePack = {
      origin: 'pack',
      id: pin.id,
      version: pin.version,
      pinnedHash: pin.hash,
      dir,
      label: rel,
      folder,
      validation: validatePack(folder),
    }
    memo?.set(dir, source)
    diagnostics.push(...packDiagnostics(source, pin))
    packs.push(source)
  }
  return { app, identity, packs, diagnostics }
}

/** The text of a file in a pack, or undefined. */
export function textOf(folder: PackFolder, path: string): string | undefined {
  const bytes = folder.files.get(path)
  if (!bytes) return undefined
  const text = new TextDecoder().decode(bytes)
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** A JSON file of a pack, parsed; `undefined` when absent, an `Error` when it does not parse. */
export function jsonOf(folder: PackFolder, path: string): unknown {
  const text = textOf(folder, path)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch (e) {
    return new Error((e as Error).message)
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** The atoms of one source, as validation derived them. */
export function atomsOf(source: SourcePack): readonly AtomRef[] {
  return source.validation.atoms
}
