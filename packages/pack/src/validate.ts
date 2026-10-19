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
const APP_CONTENT = 'app/content/'
const ENTITIES_FILE = 'app/definitions/entities.json'
const AUTH_FILE = 'app/definitions/auth.json'
const ACCESS_VERBS = new Set(['create', 'list', 'view', 'update', 'delete', 'count', 'read', 'write'])
const normName = (s: string): string => s.toLowerCase().replace(/[\s_-]/g, '')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A Markdown file at depth `depth` (segments), e.g. `atoms/README.md` at 2. */
function isDocFile(parts: readonly string[], depth: number): boolean {
  return parts.length === depth && (parts[depth - 1] as string).toLowerCase().endsWith('.md')
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
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
 * has no provenance entry (see `mediaDeclarations`); an `app/content/<typeId>.json`
 * for an undeclared entity, not shaped
 * `{ data: [...] }`, or with a record whose `id` is missing, not a UUID or
 * repeated.
 *
 * Warnings: two paths that collide on a case-insensitive file system;
 * unknown top-level entries; unknown families under `atoms/`; the
 * rootless or mixed layout; `pwpack.json` declaring a newer format; an app
 * entry not in its surface order or a key listed twice; files under
 * `app/surfaces/` that are not receipts; a receipt whose key is not in
 * `app.surfaceOrder` (the app never serves it); an `access.rules` entry naming
 * an undeclared entity, an unknown subject or a word that is not a verb
 * (`APP_ACCESS_RULE`); content for a collection only `own` readers reach
 * (`APP_CONTENT_UNREADABLE`); media files without provenance, or
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
      continue
    }
    // The pages an app serves are app.surfaceOrder. A receipt written without
    // its key there is a page nobody can reach — every link to it lands on
    // not-found — and the pack still validated clean.
    const key = rest.slice(0, -RECEIPT_SUFFIX.length)
    if (identity?.app && !identity.app.surfaceOrder.includes(key) && identity.app.entry !== key) {
      add('warning', 'APP_SURFACE_NOT_SERVED', `${path} is not in pwpack.json app.surfaceOrder, so the app does not serve it — add "${key}" there`, path)
    }
  }

  // ---- app access: who may do what with the app's records (definitions, `access`) ----
  // Each rule names an entity, a subject (`public`, `member`, or a declared
  // role) and verbs. A server ignores what it does not know, so a misspelt
  // rule silently grants nothing: report it.
  const entityNames = new Map<string, string>() // normalised typeId/displayName -> typeId
  const entitiesFile = pack.files.get(ENTITIES_FILE)
  const entitiesDoc = entitiesFile ? parseJson(entitiesFile) : undefined
  if (entitiesDoc?.ok && isRecord(entitiesDoc.value) && Array.isArray(entitiesDoc.value['entities'])) {
    for (const e of entitiesDoc.value['entities']) {
      if (!isRecord(e) || typeof e['typeId'] !== 'string') continue
      entityNames.set(normName(e['typeId']), e['typeId'])
      if (typeof e['displayName'] === 'string') entityNames.set(normName(e['displayName']), e['typeId'])
    }
  }
  /** typeId -> whether some rule lets a subject list it whole (not only `own`). */
  const ruled = new Map<string, boolean>()
  const authFile = pack.files.get(AUTH_FILE)
  const authDoc = authFile ? parseJson(authFile) : undefined
  const access = authDoc?.ok && isRecord(authDoc.value) && isRecord(authDoc.value['access']) ? authDoc.value['access'] : undefined
  if (access && Array.isArray(access['rules'])) {
    const roles = new Set(Array.isArray(access['roles']) ? access['roles'].filter((r): r is string => typeof r === 'string') : [])
    access['rules'].forEach((r: unknown, i: number) => {
      if (!isRecord(r)) return
      const at = `${AUTH_FILE} access.rules[${i}]`
      const model = typeof r['model'] === 'string' ? r['model'] : ''
      const subject = typeof r['subject'] === 'string' ? r['subject'].trim() : ''
      const words = (typeof r['rule'] === 'string' ? r['rule'] : '').toLowerCase().split(/[\s,]+/).filter(Boolean)
      const typeId = entityNames.get(normName(model))
      if (!typeId) add('warning', 'APP_ACCESS_RULE', `${at} names "${model}", which ${ENTITIES_FILE} does not declare`, AUTH_FILE)
      if (subject !== 'public' && subject !== 'member' && !roles.has(subject)) {
        add('warning', 'APP_ACCESS_RULE', `${at} is for "${subject}": write public, member, or a role listed in access.roles`, AUTH_FILE)
      }
      const unknown = words.filter((w) => w !== 'own' && !ACCESS_VERBS.has(w))
      if (unknown.length > 0) add('warning', 'APP_ACCESS_RULE', `${at} has words that are not verbs (${unknown.join(', ')}); a server ignores them. Verbs: ${[...ACCESS_VERBS].join(', ')}, and own`, AUTH_FILE)
      if (!words.some((w) => ACCESS_VERBS.has(w))) add('warning', 'APP_ACCESS_RULE', `${at} has no verb, so it grants nothing`, AUTH_FILE)
      if (typeId) {
        const listsWhole = !words.includes('own') && words.some((w) => w === 'list' || w === 'read')
        ruled.set(typeId, (ruled.get(typeId) ?? false) || listsWhole)
      }
    })
  }

  // ---- app content: the records an app ships for every visitor ----
  // app/content/<typeId>.json is published into the record store once per
  // record (insert when the id is absent, never overwrite). Its ids must be
  // stable and server-grade. A content record has no creator, so a collection
  // the rules let visitors read only `own` records of shows it to nobody.
  const contentPaths = paths.filter((p) => p.startsWith(APP_CONTENT))
  if (contentPaths.length > 0) {
    const declared = new Set(entityNames.values())
    for (const path of contentPaths) {
      const rest = path.slice(APP_CONTENT.length)
      if (rest.includes('/') || !rest.endsWith('.json')) {
        add('warning', 'APP_UNEXPECTED_FILE', `${path} is not an app/content/<typeId>.json`, path)
        continue
      }
      const typeId = rest.slice(0, -'.json'.length)
      const parsed = parseJson(pack.files.get(path) as Uint8Array)
      if (!parsed.ok) continue // JSON_INVALID below
      if (!declared.has(typeId)) {
        add('error', 'APP_CONTENT_UNDECLARED', `${path} fills "${typeId}", which ${ENTITIES_FILE} does not declare`, path)
        continue
      }
      if (ruled.get(typeId) === false) {
        add('warning', 'APP_CONTENT_UNREADABLE', `${path} fills "${typeId}", but the access rules let nobody read it except their own records; no visitor sees this content`, path)
      }
      const doc = parsed.value
      if (!isRecord(doc) || !Array.isArray(doc['data'])) {
        add('error', 'APP_CONTENT_INVALID', `${path} must be { "data": [ ...records ] }`, path)
        continue
      }
      const seen = new Set<string>()
      doc['data'].forEach((row: unknown, i: number) => {
        const id = isRecord(row) ? row['id'] : undefined
        if (typeof id !== 'string' || !UUID.test(id)) {
          add('error', 'APP_CONTENT_ID', `${path} data[${i}] needs an "id" that is a UUID: it stays the record's id once published, and relations point at it`, path)
        } else if (seen.has(id.toLowerCase())) {
          add('error', 'APP_CONTENT_ID', `${path} data[${i}] repeats id ${id}`, path)
        } else seen.add(id.toLowerCase())
      })
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
