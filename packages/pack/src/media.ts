/**
 * Media: an app's media declarations and the bytes they name.
 *
 *   app/media/<key>.json     one declaration: which image or file, which page slots
 *   media/<name>             the bytes (images, video, fonts)
 *   media/provenance.json    where each file under media/ came from, and its hash
 *
 * {@link mediaDeclarations} is the one reader of that layout, so a host that
 * ingests a pack, a generator that writes one and the CLI that serves one do
 * not each re-implement it.
 *
 * @module @pwfabric/pack/media
 */
import {
  safeParseMediaDeclaration,
  safeParseMediaProvenance,
  type MediaDeclaration,
  type MediaProvenance,
  type MediaProvenanceEntry,
} from '@pwfabric/contracts'
import type { PackFolder, PackIssue } from './types.js'
import { sortedPaths } from './paths.js'
import { stripBom } from './manifest.js'

/** The provenance record of the media a pack carries. */
export const MEDIA_PROVENANCE_FILE = 'media/provenance.json'
/** Where media bytes live. */
export const MEDIA_DIR = 'media/'
/** Where media declarations live: `app/media/<key>.json`. */
export const MEDIA_DECLARATIONS_DIR = 'app/media/'
/** A folder no pack may carry: declarations and bytes live in `app/media/` and `media/`. */
export const LEGACY_ASSETS_DIR = 'app/assets/'

/** One declaration, with the bytes it names when the pack carries them. */
export interface PackMediaDeclaration {
  /** The declaration's key: its file name without `.json`. */
  readonly key: string
  /** The declaration file, `app/media/<key>.json`. */
  readonly path: string
  readonly declaration: MediaDeclaration
  /** Pack path of the bytes `file` names, when the pack carries them (`media/hero.webp`). */
  readonly filePath?: string
  readonly bytes?: Uint8Array
  /** The provenance entry for `filePath`, when `media/provenance.json` is valid and lists it. */
  readonly provenance?: MediaProvenanceEntry
}

export interface PackMedia {
  /** Valid declarations, in byte order of their path. Invalid ones are reported in `issues` and left out. */
  readonly declarations: readonly PackMediaDeclaration[]
  /** `media/provenance.json`, when present and valid. */
  readonly provenance: MediaProvenance | null
  /** What `validatePack` reports about media declarations. */
  readonly issues: readonly PackIssue[]
}

/** `media/provenance.json`, parsed: absent, invalid (with its issues) or valid. */
export type ProvenanceRead =
  | { readonly state: 'absent' }
  | { readonly state: 'invalid'; readonly issues: readonly string[] }
  | { readonly state: 'valid'; readonly value: MediaProvenance }

/** Read and check `media/provenance.json`. */
export function readMediaProvenance(pack: PackFolder): ProvenanceRead {
  const bytes = pack.files.get(MEDIA_PROVENANCE_FILE)
  if (!bytes) return { state: 'absent' }
  let value: unknown
  try {
    value = JSON.parse(stripBom(new TextDecoder().decode(bytes)))
  } catch (e) {
    return { state: 'invalid', issues: [`is not JSON: ${(e as Error).message}`] }
  }
  const result = safeParseMediaProvenance(value)
  return result.ok ? { state: 'valid', value: result.value } : { state: 'invalid', issues: result.issues }
}

/** Files directly in `dir` ending in `.json`, as `[key, path]`. */
function declarationFiles(paths: readonly string[], dir: string): [string, string][] {
  const out: [string, string][] = []
  for (const path of paths) {
    if (!path.startsWith(dir)) continue
    const rest = path.slice(dir.length)
    if (rest.includes('/') || !rest.endsWith('.json') || rest === '.json') continue
    out.push([rest.slice(0, -'.json'.length), path])
  }
  return out
}

/**
 * The pack's media declarations (`app/media/<key>.json`), each with the bytes
 * its `file` names (a pack path, `media/<name>`) and that file's provenance
 * entry.
 *
 * Findings (also reported by `validatePack`, all errors unless noted):
 * - `LEGACY_ASSETS_FOLDER` — a file under `app/assets/`. Nothing there is
 *   read: declarations belong in `app/media/`, bytes in `media/`.
 * - `MEDIA_DECLARATION_INVALID` — a declaration that parses as JSON but
 *   breaks its schema; it is left out. (Not JSON at all is `JSON_INVALID`,
 *   reported by `validatePack`.)
 * - `MEDIA_FILE_MISSING` — `file` names bytes the pack does not carry.
 * - `MEDIA_FILE_UNRECORDED` — `file`'s bytes have no entry in
 *   `media/provenance.json`. Not reported when the record is itself invalid
 *   (`MEDIA_PROVENANCE_INVALID` covers it).
 * - `APP_UNEXPECTED_FILE` (warning) — a file under `app/media/` that is not
 *   `<key>.json`.
 *
 * Never throws for content problems.
 */
export function mediaDeclarations(pack: PackFolder): PackMedia {
  const issues: PackIssue[] = []
  const add = (severity: PackIssue['severity'], code: string, message: string, path: string): void => {
    issues.push({ severity, code, message, path })
  }
  const paths = sortedPaths(pack.files.keys())

  for (const path of paths) {
    if (path.startsWith(LEGACY_ASSETS_DIR)) {
      add('error', 'LEGACY_ASSETS_FOLDER', `${path} is under app/assets/, which is not read: declarations go in app/media/<key>.json, bytes in media/`, path)
    }
  }
  const decls = declarationFiles(paths, MEDIA_DECLARATIONS_DIR)
  const keyed = new Set(decls.map(([, p]) => p))
  for (const path of paths) {
    if (path.startsWith(MEDIA_DECLARATIONS_DIR) && !keyed.has(path)) {
      add('warning', 'APP_UNEXPECTED_FILE', `${path} is not an app/media/<key>.json; media bytes belong in media/`, path)
    }
  }

  const provenanceRead = readMediaProvenance(pack)
  const provenance = provenanceRead.state === 'valid' ? provenanceRead.value : null
  const provenanceByPath = new Map((provenance?.items ?? []).map((item) => [item.path, item]))

  const declarations: PackMediaDeclaration[] = []
  for (const [key, path] of decls) {
    let raw: unknown
    try {
      raw = JSON.parse(stripBom(new TextDecoder().decode(pack.files.get(path) as Uint8Array)))
    } catch {
      continue // JSON_INVALID, reported by validatePack for every file under app/
    }
    const parsed = safeParseMediaDeclaration(raw)
    if (!parsed.ok) {
      for (const issue of parsed.issues) add('error', 'MEDIA_DECLARATION_INVALID', `${path} ${issue}`, path)
      continue
    }
    const declaration = parsed.value
    if (declaration.file === undefined) {
      declarations.push({ key, path, declaration })
      continue
    }
    const filePath = declaration.file
    if (!pack.files.has(filePath)) {
      add('error', 'MEDIA_FILE_MISSING', `${path} names file ${filePath}, which the pack does not carry`, path)
      declarations.push({ key, path, declaration })
      continue
    }
    const entry = provenanceByPath.get(filePath)
    if (!entry && provenanceRead.state !== 'invalid') {
      add('error', 'MEDIA_FILE_UNRECORDED', `${filePath}, named by ${path}, has no entry in media/provenance.json`, filePath)
    }
    declarations.push({
      key,
      path,
      declaration,
      filePath,
      bytes: pack.files.get(filePath) as Uint8Array,
      ...(entry ? { provenance: entry } : {}),
    })
  }

  return { declarations, provenance, issues }
}
