/**
 * Validation of a pack folder held in memory. Reports, never throws, for
 * content problems.
 *
 * @module @pwfabric/pack/validate
 */
import {
  addressTable,
  checkPropValue,
  FONT_FALLBACKS,
  layoutSlotProblems,
  localePrefix,
  localesOf,
  localesProblems,
  missingCatalogueIds,
  propShapeProblems,
  receiptPathOf,
  type AtomRef,
  type PropShape,
  type PwpackIdentity,
} from '@pwfabric/contracts'
import { classifyPackPath } from '@pwfabric/contracts/pack'
import { safeParseBlockOrigins, safeParsePwpackIdentity } from '@pwfabric/contracts/schemas'
import type { PackFolder, PackIssue } from './types.js'
import { findCaseConflicts, findPathConflict, sortedPaths, unsafePathReason } from './paths.js'
import { PACK_DOC_FILES } from './content.js'
import { atomOccurrences, deriveAtoms, IDENTITY_FILE, stripBom } from './manifest.js'
import { sha256Hex } from './hash.js'
import { blockPropDescriptors } from './block-props.js'
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
/** The app's layout, the receipt every page is drawn in (receipt §4). */
export const LAYOUT_FILE = 'app/layout.receipt.json'
/** The members a layout does not carry: a page's own (receipt §4). */
const LAYOUT_FORBIDDEN = ['title', 'titleTemplate', 'description', 'appearance', 'layout', 'path'] as const
/** The app's appearance, whose theme names its fonts. */
const APPEARANCE_FILE = 'app/definitions/appearance.json'
/** The generic families a font stack may name without files (appearance §3.3). */
const GENERIC_FAMILIES: ReadonlySet<string> = new Set(FONT_FALLBACKS)
/** A font file: at most 500 KB (appearance §3.3). */
const FONT_FILE_MAX = 512_000

/** Why a font file cannot be served, or undefined: missing, not WOFF2 (by name or bytes), larger than 500 KB. */
function fontFileProblem(src: string, bytes: Uint8Array | undefined): string | undefined {
  if (!bytes) return 'the pack does not have'
  if (!src.endsWith('.woff2')) return 'is not a .woff2 file'
  if (bytes.byteLength < 4 || bytes[0] !== 0x77 || bytes[1] !== 0x4f || bytes[2] !== 0x46 || bytes[3] !== 0x32) return 'is not WOFF2 (its bytes do not start with wOF2)'
  if (bytes.byteLength > FONT_FILE_MAX) return `is ${bytes.byteLength} bytes, more than the 500 KB a font file may be`
  return undefined
}

/** The first family of a font stack, unquoted; undefined for none. */
function firstFamily(stack: unknown): string | undefined {
  if (typeof stack !== 'string') return undefined
  const first = stack.split(',')[0]?.trim().replace(/^["']|["']$/g, '').trim()
  return first ? first : undefined
}

/** The catalogues of an app in several languages (envelope §2.3). */
const APP_MESSAGES = 'app/messages/'
/** A page key: a name, or names joined by `/` for a page in a folder of `app/surfaces/`. */
const PAGE_PATH = /^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/
const PLAN_FILE = 'app/plan.json'
const PUBLIC_DIR = 'public/'

/** Files the build writes at the root of the served app (pwpack-format §1.4). */
export const PUBLIC_RESERVED_FILES: ReadonlySet<string> = new Set([
  'index.html',
  '404.html',
  '_headers',
  '_redirects',
  'robots.txt',
  'sitemap.xml',
  'llms.txt',
  'llms-full.txt',
])
/** Folders of the served app the build owns (pwapp-format §1). */
export const PUBLIC_RESERVED_DIRS: readonly string[] = ['assets', 'shims', 'blocks', 'engines', 'pwpack']

/**
 * Why a public file at `rel` (its path in the served app) is on a path the
 * build writes, or `undefined`: a fixed file, a runtime folder, or a page's
 * own document (`<key>/index.html`, under either routing).
 */
export function publicReservedReason(rel: string, pageKeys: readonly string[], localePrefixes: readonly string[] = []): string | undefined {
  if (PUBLIC_RESERVED_FILES.has(rel)) return 'the build writes itself'
  const top = rel.split('/')[0] as string
  if (PUBLIC_RESERVED_DIRS.includes(top)) return `is in ${top}/, a folder of the build's own`
  // A locale's prefix names that locale's site (envelope §2.3).
  if (rel.includes('/') && localePrefixes.includes(`${top.toLowerCase()}/`)) return `is in ${top}/, the address prefix of a locale`
  if (rel.endsWith('/index.html') && pageKeys.includes(rel.slice(0, -'/index.html'.length))) {
    return `is the document of page "${rel.slice(0, -'/index.html'.length)}"`
  }
  return undefined
}

const SCRIPT_FILE = /\.(?:js|mjs|cjs|wasm)$/
const MARKUP_FILE = /\.(?:html|htm|xhtml|svg|xml)$/

/**
 * Why a public file is script, or `undefined`: a script or WebAssembly file,
 * or markup holding a `<script` element, an `on…` attribute or a
 * `javascript:` URL (compared in lower case, over the text as written).
 */
export function publicScriptReason(rel: string, bytes: Uint8Array): string | undefined {
  const name = rel.toLowerCase()
  if (SCRIPT_FILE.test(name)) return 'is a script file'
  if (!MARKUP_FILE.test(name)) return undefined
  const text = new TextDecoder().decode(bytes).toLowerCase()
  if (text.includes('<script')) return 'holds a <script> element'
  if (/<[^>]*\son[a-z0-9_-]*\s*=/.test(text)) return 'holds an on… event attribute'
  if (/javascript\s*:/.test(text)) return 'holds a javascript: URL'
  return undefined
}
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

/** A source file the compiler bundles: TypeScript or JavaScript. */
const SOURCE_FILE = /\.(?:tsx?|mts|cts|jsx?|mjs|cjs)$/
/** A pack's own tests: they never ship, and may use what they like. */
const TEST_FILE = /(?:^|\/)(?:__tests__|__fixtures__|test|tests)\/|\.(?:test|spec)\.[^/]+$/

/** What a block author does about a zod import (shared wording with the compiler's ZOD_IMPORT). */
export const ZOD_REMEDY =
  "A block's props are declared in its manifest (definition.props: type, default, enum, bounds, shape) and the runtime applies them, so no visitor page carries zod. Run `pwf migrate blocks <folder>` to move the schema into the manifest, then delete the import."

/**
 * The 1-based line of the first value import of zod (`import … from 'zod'`,
 * `import 'zod'`, `export … from 'zod'`, `import('zod')`, a `zod/…` subpath),
 * or `undefined`. A type-only import (`import type`) is erased and allowed.
 * Comments are not read.
 */
export function zodImportLine(source: string): number | undefined {
  const masked = source.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '')
  const re = /\b(import|export)\s+(type\s+)?(?:[^'"`;]*?\sfrom\s+)?['"](zod(?:\/[^'"]*)?)['"]|\bimport\s*\(\s*['"](zod(?:\/[^'"]*)?)['"]\s*\)/g
  for (const m of masked.matchAll(re)) {
    if (m[2]) continue
    return masked.slice(0, m.index).split('\n').length
  }
  return undefined
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
 * repeated; a block manifest whose `definition.origins` is not a map of
 * known directives to exact origins (`BLOCK_ORIGIN_INVALID`); a source file
 * that imports zod (`BLOCK_IMPORTS_ZOD`: a block's props are declared in its
 * manifest, and no visitor page carries zod — 3.0).
 *
 * Warnings: a block manifest prop whose shape (`jsonSchema`) uses what the
 * runtime does not read, or whose default does not fit it
 * (`BLOCK_PROP_DECLARATION`); two paths that collide on a case-insensitive file system;
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
    // Files a build copies, as they are, to the root of the served app.
    if (top === 'public' && parts.length > 1) continue
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
    add('warning', 'UNKNOWN_TOP_LEVEL', `${name} is not part of the pwpack folder (pwpack.json, app/, atoms/, media/, public/)`, name)
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
    const { entry, surfaceOrder, notFound, signIn } = identity.app
    const receipt = (key: string): string => `${APP_SURFACES}${key}${RECEIPT_SUFFIX}`
    const missing = new Set<string>()
    for (const key of [entry, ...surfaceOrder, ...(notFound ? [notFound] : []), ...(signIn ? [signIn] : [])]) {
      if (!pack.files.has(receipt(key)) && !missing.has(key)) {
        missing.add(key)
        add('error', 'APP_SURFACE_MISSING', `pwpack.json app names surface "${key}" but ${receipt(key)} is absent`, receipt(key))
      }
    }
    if (notFound && surfaceOrder.includes(notFound)) {
      add('warning', 'APP_NOT_FOUND_IS_A_ROUTE', `app.notFound "${notFound}" is also in app.surfaceOrder, so its address answers "found" — keep it out of the route table`, IDENTITY_FILE)
    }
    if (signIn && surfaceOrder.includes(signIn)) {
      add('warning', 'APP_SIGN_IN_IS_A_ROUTE', `app.signIn "${signIn}" is also in app.surfaceOrder — the sign-in screen is drawn where it is needed, not linked to; keep it out of the route table`, IDENTITY_FILE)
    }
    if (!surfaceOrder.includes(entry)) {
      add('warning', 'APP_ENTRY_NOT_IN_ORDER', `app.entry "${entry}" is not listed in app.surfaceOrder`, IDENTITY_FILE)
    }
    const seen = new Set<string>()
    for (const key of surfaceOrder) {
      if (seen.has(key)) add('warning', 'APP_SURFACE_DUPLICATE', `app.surfaceOrder lists "${key}" more than once`, IDENTITY_FILE)
      seen.add(key)
    }
    // The plan's pages (`app/plan.json` `surfaces`) are optional: absent, they
    // are app.surfaceOrder. Present, they agree with app (plan §3.1): every
    // served page is planned, an `applied` plan page is served, and the plan's
    // entry is app.entry.
    const planBytes = pack.files.get(PLAN_FILE)
    const plan = planBytes ? parseJson(planBytes) : undefined
    const planned = plan?.ok && isRecord(plan.value) ? plan.value['surfaces'] : undefined
    if (planned !== undefined) {
      const mismatch = (message: string): void => add('error', 'APP_PLAN_SURFACE_MISMATCH', message, PLAN_FILE)
      const served = [...new Set([entry, ...surfaceOrder, ...(notFound ? [notFound] : []), ...(signIn ? [signIn] : [])])]
      const pages = Array.isArray(planned) ? planned.filter(isRecord) : []
      if (!Array.isArray(planned) || pages.length !== planned.length || pages.some((p) => typeof p['key'] !== 'string')) {
        mismatch(`${PLAN_FILE} surfaces must be a list of pages, each with a "key"`)
      } else {
        const keys = pages.map((p) => p['key'] as string)
        for (const key of served) {
          if (!keys.includes(key)) mismatch(`pwpack.json app serves "${key}", which ${PLAN_FILE} surfaces does not list — add it there, or leave surfaces out`)
        }
        for (const page of pages) {
          const key = page['key'] as string
          if (page['status'] === 'applied' && !served.includes(key)) {
            mismatch(`${PLAN_FILE} surfaces has "${key}" applied, but pwpack.json app does not serve it — add it to app.surfaceOrder, or mark it as not built yet`)
          }
          if (page['isEntry'] === true && key !== entry) mismatch(`${PLAN_FILE} surfaces marks "${key}" as the entry, but app.entry is "${entry}"`)
        }
      }
    }
  }
  // ---- the layout (receipt §4): exactly one bare page slot, outside any repeat ----
  const layoutBytes = pack.files.get(LAYOUT_FILE)
  const layoutDoc = layoutBytes ? parseJson(layoutBytes) : undefined
  if (layoutDoc?.ok) {
    const problems = layoutSlotProblems(layoutDoc.value)
    if (problems.length > 0) add('error', 'APP_LAYOUT_SLOT', `${LAYOUT_FILE}: ${problems.join('; ')}`, LAYOUT_FILE)
    // The page's own members: the layout's blocks wear the page's.
    const layoutValue = layoutDoc.value
    const own = isRecord(layoutValue) ? LAYOUT_FORBIDDEN.filter((m) => layoutValue[m] !== undefined) : []
    if (own.length > 0) add('error', 'APP_LAYOUT_INVALID', `${LAYOUT_FILE} carries ${own.join(', ')}, which belong to a page, not to the layout`, LAYOUT_FILE)
  }
  // ---- fonts (appearance §3.3): the app's own woff2 files ----
  const appearanceBytes = pack.files.get(APPEARANCE_FILE)
  const appearanceDoc = appearanceBytes ? parseJson(appearanceBytes) : undefined
  if (appearanceDoc?.ok && isRecord(appearanceDoc.value)) {
    const root = isRecord(appearanceDoc.value['config']) ? appearanceDoc.value['config'] : appearanceDoc.value
    const tokenSets = [root['theme'], root['darkTheme']].filter(isRecord)
    const shipped = new Set<string>()
    const judged = new Set<string>()
    for (const set of tokenSets) {
      for (const font of Array.isArray(set['fonts']) ? set['fonts'] : []) {
        if (!isRecord(font)) continue
        if (typeof font['family'] === 'string') shipped.add(font['family'].trim().toLowerCase())
        for (const file of Array.isArray(font['files']) ? font['files'] : []) {
          const src = isRecord(file) && typeof file['src'] === 'string' ? file['src'] : undefined
          if (src === undefined || judged.has(src)) continue
          judged.add(src)
          const problem = fontFileProblem(src, pack.files.get(src))
          if (problem) add('error', 'FONT_FILE_INVALID', `${APPEARANCE_FILE} names the font file ${src}, which ${problem}`, src.startsWith('media/') ? src : APPEARANCE_FILE)
        }
      }
    }
    const missing = new Set<string>()
    for (const set of tokenSets) {
      const typography = isRecord(set['typography']) ? set['typography'] : {}
      for (const token of ['fontFamily', 'headingFontFamily', 'monoFontFamily']) {
        const first = firstFamily(typography[token])
        if (first === undefined || GENERIC_FAMILIES.has(first.toLowerCase()) || shipped.has(first.toLowerCase()) || missing.has(first)) continue
        missing.add(first)
        add(
          'warning',
          'FONT_FILES_MISSING',
          `${APPEARANCE_FILE} names the family "${first}" (${token}) but ships no files for it, so it is drawn in its fallback: add its woff2 files under media/fonts/ and list them in the theme's fonts (pwf font add "${first}" --from …)`,
          APPEARANCE_FILE
        )
      }
    }
  }
  // ---- locales (envelope §2.3) ----
  const planDoc = pack.files.get(PLAN_FILE) ? parseJson(pack.files.get(PLAN_FILE) as Uint8Array) : undefined
  const planValue = planDoc?.ok ? planDoc.value : undefined
  const localeProblems = localesProblems(planValue)
  if (localeProblems.length > 0) add('error', 'APP_LOCALES_INVALID', `${PLAN_FILE}: ${localeProblems.join('; ')}`, PLAN_FILE)
  const localeDecl = localesOf(planValue)
  if (localeDecl && identity?.app) {
    const { entry, surfaceOrder } = identity.app
    const pathOf = (key: string): Readonly<Record<string, string>> | undefined => {
      const bytes = pack.files.get(`${APP_SURFACES}${key}${RECEIPT_SUFFIX}`)
      const doc = bytes ? parseJson(bytes) : undefined
      return doc?.ok ? receiptPathOf(doc.value) : undefined
    }
    const table = addressTable(localeDecl, [...new Set(surfaceOrder)], entry, pathOf)
    for (const problem of table.problems) add('error', 'APP_ADDRESS_CONFLICT', problem, PLAN_FILE)
  }
  // The catalogues: one per declared locale, each with the default's ids.
  const catalogues = new Map<string, Record<string, unknown>>()
  for (const path of paths) {
    if (!path.startsWith(APP_MESSAGES)) continue
    const lang = path.slice(APP_MESSAGES.length).replace(/\.json$/, '')
    if (!localeDecl || !path.endsWith('.json') || !localeDecl.locales.includes(lang)) {
      add('warning', 'APP_UNEXPECTED_FILE', `${path} is not an ${APP_MESSAGES}<lang>.json of a locale app/plan.json declares`, path)
      continue
    }
    const doc = parseJson(pack.files.get(path) as Uint8Array)
    if (doc.ok && isRecord(doc.value)) catalogues.set(lang, doc.value)
  }
  if (localeDecl) {
    const defaults = catalogues.get(localeDecl.defaultLocale) ?? {}
    for (const lang of localeDecl.locales) {
      if (lang === localeDecl.defaultLocale) continue
      const path = `${APP_MESSAGES}${lang}.json`
      for (const id of missingCatalogueIds(defaults, catalogues.get(lang) ?? {})) {
        add('warning', 'MESSAGES_LOCALE_MISSING', `${path} does not set "${id}", which ${APP_MESSAGES}${localeDecl.defaultLocale}.json sets: "${lang}" reads the default's word`, path)
      }
    }
  }
  // ---- public files (copied, as they are, to the served app's root) ----
  // None may land on a path the build writes, and none may be script:
  // script code enters an app through its blocks only, compiled and pinned.
  const pageKeys = identity?.app
    ? [identity.app.entry, ...identity.app.surfaceOrder, ...(identity.app.notFound ? [identity.app.notFound] : []), ...(identity.app.signIn ? [identity.app.signIn] : [])]
    : []
  for (const path of paths) {
    if (!path.startsWith(PUBLIC_DIR) || path === PUBLIC_DIR) continue
    const rel = path.slice(PUBLIC_DIR.length)
    const reason = publicReservedReason(rel, pageKeys, localeDecl ? localeDecl.locales.filter((l) => l !== localeDecl.defaultLocale).map(localePrefix) : [])
    if (reason) add('error', 'APP_PUBLIC_RESERVED', `${path} would be served at /${rel}, which ${reason}; rename or move it`, path)
    const script = publicScriptReason(rel, pack.files.get(path) as Uint8Array)
    if (script) add('error', 'APP_PUBLIC_SCRIPT', `${path} ${script}; script code enters an app only through its blocks`, path)
  }
  for (const path of paths) {
    if (!path.startsWith(APP_SURFACES)) continue
    const rest = path.slice(APP_SURFACES.length)
    // A page may sit in a folder: app/surfaces/docs/intro.receipt.json is
    // page `docs/intro` (served at docs/intro/ under path routing).
    if (!rest.endsWith(RECEIPT_SUFFIX) || !PAGE_PATH.test(rest.slice(0, -RECEIPT_SUFFIX.length))) {
      add('warning', 'APP_UNEXPECTED_FILE', `${path} is not an app/surfaces/<key>.receipt.json (or app/surfaces/<folder>/<key>.receipt.json)`, path)
      continue
    }
    // The pages an app serves are app.surfaceOrder. A receipt written without
    // its key there is a page nobody can reach — every link to it lands on
    // not-found — and the pack still validated clean.
    let key = rest.slice(0, -RECEIPT_SUFFIX.length)
    // A page's receipt for one declared locale (`home.de`) is that page's.
    const ofLocale = localeDecl?.locales.find((l) => key.endsWith(`.${l}`))
    if (ofLocale !== undefined) key = key.slice(0, -(ofLocale.length + 1))
    if (identity?.app && !identity.app.surfaceOrder.includes(key) && identity.app.entry !== key && identity.app.notFound !== key && identity.app.signIn !== key) {
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
  const blockDirs = new Set<string>()
  for (const { ref, dir } of atomOccurrences(pack)) {
    const key = `${ref.kind}:${ref.id}`
    if (ref.kind === 'block') blockDirs.add(dir)
    const seenDir = firstDir.get(key)
    if (seenDir === undefined) firstDir.set(key, dir)
    else if (seenDir !== dir) {
      add('error', 'DUPLICATE_ATOM', `${key} comes from both ${seenDir} and ${dir}`, ref.relPath)
    }
  }
  // A block's declared origins go into every app's Content Security Policy
  // that places it; a malformed one would open the policy wider than meant,
  // or not at all.
  for (const dir of blockDirs) {
    const path = `${dir}manifest.json`
    const bytes = pack.files.get(path)
    const parsed = bytes ? parseJson(bytes) : undefined
    if (!parsed?.ok || !isRecord(parsed.value) || !isRecord(parsed.value['definition'])) continue
    const origins = parsed.value['definition']['origins']
    if (origins === undefined) continue
    const result = safeParseBlockOrigins(origins)
    if (!result.ok) {
      for (const issue of result.issues) add('error', 'BLOCK_ORIGIN_INVALID', `${path} definition.origins — ${issue}`, path)
    }
  }

  // ---- block props: the manifest is their only definition ----
  for (const dir of blockDirs) {
    const path = `${dir}manifest.json`
    const bytes = pack.files.get(path)
    const parsed = bytes ? parseJson(bytes) : undefined
    if (!parsed?.ok) continue
    for (const d of blockPropDescriptors(parsed.value) ?? []) {
      const shape = (d as { jsonSchema?: unknown }).jsonSchema
      const problems = shape === undefined ? [] : propShapeProblems(shape, d.name)
      const fallback = d.default
      if (problems.length === 0 && fallback !== undefined && isRecord(shape)) {
        problems.push(...checkPropValue(fallback, shape as PropShape, `${d.name} default`).map((i) => i.message))
      }
      for (const problem of problems) add('warning', 'BLOCK_PROP_DECLARATION', `${path} definition.props — ${problem}`, path)
    }
  }

  // ---- sources: no zod (3.0) ----
  // A block's props are declared in its manifest and applied by the runtime
  // without a validation library; no visitor page carries zod. A source that
  // still imports it fails here, before the compiler refuses it.
  for (const path of paths) {
    if (!SOURCE_FILE.test(path) || TEST_FILE.test(path)) continue
    const text = new TextDecoder().decode(pack.files.get(path) as Uint8Array)
    const line = zodImportLine(text)
    if (line !== undefined) {
      add('error', 'BLOCK_IMPORTS_ZOD', `${path}:${line} imports zod. ${ZOD_REMEDY}`, path)
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
    // A font's licence text beside it need not be recorded (pwpack-format §1.3).
    if (!declared.has(path) && !/^media\/fonts\/[^/]+\.txt$/i.test(path)) add('warning', 'MEDIA_UNDECLARED', `${path} has no entry in media/provenance.json`, path)
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
