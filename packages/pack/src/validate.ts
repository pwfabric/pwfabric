/**
 * Validation of a pack folder held in memory. Reports, never throws, for
 * content problems.
 *
 * @module @pwfabric/pack/validate
 */
import {
  classifyPackPath,
  safeParsePwpackIdentity,
  type AtomRef,
  type PwpackIdentity,
} from '@pwfabric/contracts'
import type { PackFolder, PackIssue } from './types.js'
import { findCaseConflicts, findPathConflict, sortedPaths, unsafePathReason } from './paths.js'
import { PACK_DOC_FILES } from './content.js'
import { atomOccurrences, deriveAtoms, IDENTITY_FILE, stripBom } from './manifest.js'
import { sha256Hex } from './hash.js'
import { MEDIA_PROVENANCE_FILE as MEDIA_PROVENANCE, mediaDeclarations, readMediaProvenance } from './media.js'

/** The `formatVersion` major this reader understands. A newer one gets a warning. */
export const SUPPORTED_FORMAT_MAJOR = 1

/**
 * Atom families as directory names: under `atoms/` in the canonical folder,
 * at the root in the legacy rootless layout. `lib` holds shared code and
 * `test` the pack's own tests; neither is an atom, both are expected.
 */
export const ATOM_FAMILIES: ReadonlySet<string> = new Set([
  'blocks',
  'capabilities',
  'connectors',
  'providers',
  'appearance',
  'patterns',
  'icons',
  'surfaces',
  'auth',
  'lib',
  'test',
])

/** Family directories that may sit at the root of either layout. */
const NEUTRAL_ROOT_DIRS: ReadonlySet<string> = new Set(['lib', 'test'])

/** Which layout the folder's paths use. */
export type PackLayout =
  /** `atoms/`, `app/` (and `pwpack.json`, `media/`) only. */
  | 'canonical'
  /** Atom families at the root, the pre-`atoms/` layout. */
  | 'rootless'
  /** Both at once. */
  | 'mixed'
  /** Neither: no atom or app path at all. */
  | 'empty'

export interface PackValidation {
  /** No issue has severity `error`. */
  readonly ok: boolean
  readonly issues: readonly PackIssue[]
  /** The parsed `pwpack.json`, when it is present and valid. */
  readonly identity: PwpackIdentity | null
  readonly layout: PackLayout
  /** The derived atoms (see `deriveAtoms`). */
  readonly atoms: readonly AtomRef[]
}

const APP_SURFACES = 'app/surfaces/'
const RECEIPT_SUFFIX = '.receipt.json'

/** A Markdown file at depth `depth` (segments), e.g. `atoms/README.md` at 2. */
function isDocFile(parts: readonly string[], depth: number): boolean {
  return parts.length === depth && (parts[depth - 1] as string).toLowerCase().endsWith('.md')
}

function parseJson(bytes: Uint8Array): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(stripBom(new TextDecoder().decode(bytes))) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * Validate a pack folder.
 *
 * Errors (the pack is not valid): an unsafe path; a path that is a file and
 * also another path's directory; `pwpack.json` missing,
 * not JSON, or not matching the contract schema; `app.entry` or an
 * `app.surfaceOrder` key without its `app/surfaces/<key>.receipt.json`; two
 * different atom directories yielding the same `kind:id`; a JSON file under
 * `app/` or `media/provenance.json` that does not parse; an invalid
 * `media/provenance.json` or one naming a file the pack does not carry;
 * a file under `app/assets/` (`LEGACY_ASSETS_FOLDER`); a media declaration
 * that breaks its schema, names a `file` missing from `media/`, or whose file
 * has no provenance entry (see `mediaDeclarations`).
 *
 * Warnings: two paths that collide on a case-insensitive file system;
 * unknown top-level entries; unknown families under `atoms/`; the
 * rootless or mixed layout; `pwpack.json` declaring a newer format; an app
 * entry not in its surface order or a key listed twice; files under
 * `app/surfaces/` that are not receipts; media files without provenance, or
 * whose hash disagrees with it (not reported when the provenance record is
 * itself invalid); other JSON files that do not parse; a file under
 * `app/media/` that is not a `<key>.json` declaration.
 *
 * Info: a legacy `package.json` at the root; a Markdown file directly in
 * `atoms/` or in an atom-family directory (documentation, not an atom).
 */
export function validatePack(pack: PackFolder): PackValidation {
  const issues: PackIssue[] = []
  const add = (severity: PackIssue['severity'], code: string, message: string, path?: string): void => {
    issues.push(path === undefined ? { severity, code, message } : { severity, code, message, path })
  }
  const paths = sortedPaths(pack.files.keys())

  // ---- collisions ----
  const conflict = findPathConflict(paths)
  if (conflict) {
    add('error', 'PATH_CONFLICT', `${conflict.file} is a file and also the directory of ${conflict.inside}`, conflict.file)
  }
  for (const group of findCaseConflicts(paths)) {
    add(
      'warning',
      'CASE_CONFLICT',
      `${group.join(', ')} differ only in case or Unicode normalisation; extracting them on a case-insensitive file system keeps one`,
      group[0]
    )
  }

  // ---- paths, top level and layout ----
  const unknownTop = new Set<string>()
  const unknownFamily = new Set<string>()
  let canonical = false
  let rootless = false
  for (const path of paths) {
    const reason = unsafePathReason(path)
    if (reason) {
      add('error', 'UNSAFE_PATH', `${path}: ${reason}`, path)
      continue
    }
    const parts = path.split('/')
    const top = parts[0] as string
    const cls = classifyPackPath(path)
    if (cls?.kind === 'identity') continue
    if (cls?.kind === 'app') {
      canonical = true
      continue
    }
    if (path === 'package.json') {
      add('info', 'LEGACY_PACKAGE_JSON', 'package.json at the root is legacy identity; pwpack.json is read instead', path)
      continue
    }
    if (PACK_DOC_FILES.has(path)) continue
    if (top === 'media' && parts.length > 1) continue
    if (top === 'atoms' && parts.length > 1) {
      canonical = true
      const family = parts[1] as string
      if (isDocFile(parts, 2) || (parts.length === 3 && ATOM_FAMILIES.has(family) && isDocFile(parts, 3))) {
        add('info', 'DOC_FILE', `${path} is documentation, not an atom`, path)
        continue
      }
      if (parts.length === 2 || !ATOM_FAMILIES.has(family)) unknownFamily.add(family)
      continue
    }
    if (parts.length > 1 && ATOM_FAMILIES.has(top)) {
      if (isDocFile(parts, 2)) add('info', 'DOC_FILE', `${path} is documentation, not an atom`, path)
      // Atom families at the root are the rootless layout. Root `lib/` and
      // `test/` are expected in both layouts (shared code on the legacy wire,
      // a source folder's own tests), so they do not decide the layout.
      if (!NEUTRAL_ROOT_DIRS.has(top)) rootless = true
      continue
    }
    unknownTop.add(parts.length > 1 ? `${top}/` : top)
  }
  for (const name of unknownTop) {
    add('warning', 'UNKNOWN_TOP_LEVEL', `${name} is not part of the pwpack folder (pwpack.json, app/, atoms/, media/)`, name)
  }
  for (const family of unknownFamily) {
    add('warning', 'UNKNOWN_ATOM_FAMILY', `atoms/${family} is not a known atom family`, `atoms/${family}`)
  }
  const layout: PackLayout = canonical && rootless ? 'mixed' : canonical ? 'canonical' : rootless ? 'rootless' : 'empty'
  if (layout === 'mixed') {
    add('warning', 'LAYOUT_MIXED', 'the folder mixes atoms/ with atom families at the root')
  } else if (layout === 'rootless') {
    add('warning', 'LAYOUT_ROOTLESS', 'atom families sit at the root; the canonical folder keeps them under atoms/')
  }

  // ---- identity ----
  let identity: PwpackIdentity | null = null
  const identityBytes = pack.files.get(IDENTITY_FILE)
  if (!identityBytes) {
    add('error', 'IDENTITY_MISSING', 'the folder has no pwpack.json', IDENTITY_FILE)
  } else {
    const parsed = parseJson(identityBytes)
    if (!parsed.ok) {
      add('error', 'IDENTITY_INVALID', `pwpack.json is not JSON: ${parsed.error}`, IDENTITY_FILE)
    } else {
      const result = safeParsePwpackIdentity(parsed.value)
      if (result.ok) {
        identity = result.value
      } else {
        for (const issue of result.issues) add('error', 'IDENTITY_INVALID', `pwpack.json ${issue}`, IDENTITY_FILE)
      }
    }
  }
  if (identity?.formatVersion !== undefined) {
    const major = Number(identity.formatVersion.split('.')[0])
    if (major > SUPPORTED_FORMAT_MAJOR) {
      add(
        'warning',
        'FORMAT_VERSION_NEWER',
        `pwpack.json formatVersion ${identity.formatVersion} is newer than this reader (${SUPPORTED_FORMAT_MAJOR}.x); parts of it may be ignored`,
        IDENTITY_FILE
      )
    }
  }

  // ---- app ----
  if (identity?.app) {
    const { entry, surfaceOrder } = identity.app
    const receipt = (key: string): string => `${APP_SURFACES}${key}${RECEIPT_SUFFIX}`
    const missing = new Set<string>()
    for (const key of [entry, ...surfaceOrder]) {
      if (!pack.files.has(receipt(key)) && !missing.has(key)) {
        missing.add(key)
        add('error', 'APP_SURFACE_MISSING', `pwpack.json app names surface "${key}" but ${receipt(key)} is absent`, receipt(key))
      }
    }
    if (!surfaceOrder.includes(entry)) {
      add('warning', 'APP_ENTRY_NOT_IN_ORDER', `app.entry "${entry}" is not listed in app.surfaceOrder`, IDENTITY_FILE)
    }
    const seen = new Set<string>()
    for (const key of surfaceOrder) {
      if (seen.has(key)) add('warning', 'APP_SURFACE_DUPLICATE', `app.surfaceOrder lists "${key}" more than once`, IDENTITY_FILE)
      seen.add(key)
    }
  }
  for (const path of paths) {
    if (!path.startsWith(APP_SURFACES)) continue
    const rest = path.slice(APP_SURFACES.length)
    if (rest.includes('/') || !rest.endsWith(RECEIPT_SUFFIX)) {
      add('warning', 'APP_UNEXPECTED_FILE', `${path} is not an app/surfaces/<key>.receipt.json`, path)
    }
  }

  // ---- JSON well-formedness ----
  for (const path of paths) {
    if (!path.endsWith('.json') || path === IDENTITY_FILE || path === MEDIA_PROVENANCE) continue
    const parsed = parseJson(pack.files.get(path) as Uint8Array)
    if (parsed.ok) continue
    const severity = path.startsWith('app/') ? 'error' : 'warning'
    add(severity, 'JSON_INVALID', `${path} is not JSON: ${parsed.error}`, path)
  }

  // ---- atoms ----
  const firstDir = new Map<string, string>()
  for (const { ref, dir } of atomOccurrences(pack)) {
    const key = `${ref.kind}:${ref.id}`
    const seenDir = firstDir.get(key)
    if (seenDir === undefined) firstDir.set(key, dir)
    else if (seenDir !== dir) {
      add('error', 'DUPLICATE_ATOM', `${key} comes from both ${seenDir} and ${dir}`, ref.relPath)
    }
  }

  // ---- media ----
  const mediaFiles = paths.filter((p) => p.startsWith('media/') && p !== MEDIA_PROVENANCE)
  const declared = new Set<string>()
  // Undeclared media is only computed against a provenance record that is
  // valid; an invalid one is reported once, not once per media file.
  const provenance = readMediaProvenance(pack)
  if (provenance.state === 'invalid') {
    for (const issue of provenance.issues) add('error', 'MEDIA_PROVENANCE_INVALID', `media/provenance.json ${issue}`, MEDIA_PROVENANCE)
  } else if (provenance.state === 'valid') {
    for (const item of provenance.value.items) {
      declared.add(item.path)
      const bytes = pack.files.get(item.path)
      if (!bytes) {
        add('error', 'MEDIA_PROVENANCE_PATH_MISSING', `media/provenance.json lists ${item.path}, which the pack does not carry`, item.path)
      } else if (item.hash.startsWith('sha256:') && item.hash !== `sha256:${sha256Hex(bytes)}`) {
        add('warning', 'MEDIA_HASH_MISMATCH', `${item.path} does not match the hash media/provenance.json records`, item.path)
      }
    }
  }
  for (const path of provenance.state === 'invalid' ? [] : mediaFiles) {
    if (!declared.has(path)) add('warning', 'MEDIA_UNDECLARED', `${path} has no entry in media/provenance.json`, path)
  }
  // Declarations: which layout, and whether the bytes they name are there.
  issues.push(...mediaDeclarations(pack).issues)

  return {
    ok: !issues.some((i) => i.severity === 'error'),
    issues,
    identity,
    layout,
    atoms: deriveAtoms(pack),
  }
}
