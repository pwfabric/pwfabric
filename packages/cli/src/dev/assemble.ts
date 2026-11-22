/**
 * assemblePwapp — a pwpack app folder in, a static pwapp out.
 *
 * Reads the app and the pack builds it pins (from the project's cache),
 * compiles every block, capability and engine atom with the engine's
 * compiler, resolves the app's theme, builds the envelope the runner reads,
 * and lays out the served folder of the pwapp format: shell, runner,
 * renderer, shims, block and engine modules, envelope and `publish.json`.
 *
 * Pure in its output: the same folder, cache and runtime bundles give the
 * same files (only `publish.json`'s `publishedAt` carries a clock, and it can
 * be pinned). Nothing is fetched; every input is on disk.
 */
import { join } from 'node:path'
import { ambiguousBlockTypeMessage, BLOCK_TYPE_AMBIGUOUS, blockPropDescriptors, blockTypeFirstUses, blockTypeNames, checkBlockIds, resolveBlockType, checkReceiptBlockProps, hashPack, publicReservedReason, publicScriptReason, unknownBlockTypeIssue } from '@pwfabric/pack'
import {
  addressTable,
  catalogueFor,
  layoutSlotProblems,
  localePrefix,
  localesOf,
  PAGE_SLOT_TYPE,
  receiptPathOf,
  resolveAppearanceMode,
  type AddressTable,
  type BlockOrigins,
  type LocaleDeclaration,
} from '@pwfabric/contracts'
import { atomKindMeta } from '@pwfabric/contracts/pack'
import { safeParseBlockOrigins } from '@pwfabric/contracts/schemas'
import { compileProviderBundle, compileSources, createCompileCache, providerFacetOf, type CompileCache, type CompiledAtom } from './compile.js'
import { hasErrors, sortDiagnostics, type AssembleDiagnostic } from './diagnostics.js'
import {
  blockTypesOf,
  buildConnections,
  buildProjectJson,
  deriveNavigation,
  manifestProps,
  mergeEnvelopeEntries,
  moduleFileName,
  publisherOf,
  servedPageKeys,
  type BlockManifestEntry,
  type EngineManifestEntry,
  type Page,
} from './envelope.js'
import { collectMedia, fillMediaSlots } from './media.js'
import { faviconOf } from './favicon.js'
import { bodyFontOf, fontAssetsOf, fontsOf, unreadableMetricsMessage, withFontFallbacks } from './fonts.js'
import { declaredRecordFields, withRecordFields } from '../host/record-fields.js'
import { withSessionSources } from '../host/session-sources.js'
import { authDeclarationOf, entityDeclarationsOf } from '../host/definitions.js'
import { deriveCsp, headersFile } from './csp.js'
import { documentHead, isRecordPage, pageDocuments, wordedText, publicOriginOf, robotsTxt, SERVED_FOLDERS, sitemapXml, sitemapXmlLocales, type PageDocument } from './documents.js'
import { llmsFullTxt, llmsFullTxtLocales, llmsTxt, llmsTxtLocales, type LlmsPage } from './llms.js'
import { planHeadersOf, planRedirectsOf, planScriptOrigins, planScriptsOf, redirectsFile } from './plan-site.js'
import { parseHeadersFile } from '../commands/lib/static-server.js'
import { firstPaintData, onPageFragmentLinks, paintPages, shareFrameStyles, staticPageFile, staticPageFragment, staticRootHtml, type PaintedPage } from './static-paint.js'
import { assemblePage, RENDERER_MESSAGE_IDS, RUNNER_MESSAGE_IDS, canonicalOf, colorSchemeScript, hashHref, isTitleTemplate, pathHref, pluralProblems } from '@pwfabric/runner'
import {
  BOOT_FILES,
  FIRST_PAINT_SCRIPT,
  FIRST_PAINT_SCRIPT_LOCALES,
  PAGE_HINTS_SCRIPT,
  PAGE_HINTS_SCRIPT_LOCALES,
  servedHref,
  bootScript,
  buildShellHtml,
  firstImageOf,
  hashedName,
  importMapText,
  loadRuntimeAssets,
  shimsFor,
  type RuntimeAssets,
  type PageHints,
  type RouterMode,
  type ShellAssets,
} from './shell.js'
import { engineRangeDiagnostics, isRecord, jsonOf, loadSources, PWF_DIR, type PackMemo, type SourcePack } from './sources.js'
import { engineVersion } from '../commands/lib/identity.js'
import {
  appearanceConfigOf,
  buildThemeCss,
  namedThemeOf,
  resolveAppearance,
  resolvePageAppearance,
  themeAtomOf,
  type PageAppearance,
  type PageTheme,
  type ThemeAtom,
} from './theme.js'

export interface AssembleOptions {
  /** Markup appended to the shell's `<body>` — the dev server's reload client. Absent in a build. */
  readonly shellExtra?: string
  /** Envelope files a local host adds (see `LocalHost.envelopeEntries`). */
  readonly envelopeEntries?: Readonly<Record<string, unknown>>
  /** A compile cache to reuse across builds; default: one on disk under `.pwf/build-cache/`. */
  readonly cache?: CompileCache
  /** Folder of the on-disk compile cache; `null` keeps it in memory only. */
  readonly cacheDir?: string | null
  /** `publish.json`'s `publishedAt`; default now. */
  readonly publishedAt?: string
  /** Runner and renderer bundles; default: the installed engine packages. */
  readonly runtime?: RuntimeAssets
  /** Pack builds read by an earlier build of the same session. */
  readonly packMemo?: PackMemo
  /** The engine version the folder is judged against (ENGINE_RANGE_EXCLUDED); default: this CLI's. */
  readonly engineVersion?: string
  /**
   * How the built app routes (`runApp`'s `router`); default `hash`. `path`
   * and `auto` write the app's base into the shell (`<base href>`), `auto`
   * the host's fallback too (`<meta name="pw-router" content="path">`).
   */
  readonly router?: RouterMode
  /** The app's base path under path routing; default `/`. */
  readonly base?: string
}

export interface AssembleStats {
  readonly pages: number
  /** Entries in `blocks/manifest.json`. */
  readonly blocks: number
  /** Entries in `engines/manifest.json`. */
  readonly engines: number
  /** Atoms of a compiled kind across the app and its packs. */
  readonly atoms: number
  /** Of those, how many have a module (compiled or shipped precompiled). */
  readonly compiled: number
  /** Of the compiled, how many came from the cache. */
  readonly fromCache: number
  readonly failed: number
  /**
   * The atoms of a compiled kind that have no module and did not fail, each
   * with why: an engine that is a declaration only has nothing to compile.
   * Absent when there are none.
   */
  readonly skipped?: readonly SkippedAtom[]
}

/** An atom the build has no module for, and why (see {@link AssembleStats.skipped}). */
export interface SkippedAtom {
  readonly id: string
  readonly reason: string
}

/** Why an atom of this status has no module. */
function skipReason(atom: CompiledAtom): string {
  return `${atom.kind} declared as data, no code to compile`
}

/**
 * The atom count of a build line: `56/57 atoms compiled (3 from cache; 1
 * skipped: RestConnector (connector declared as data, no code to compile))`.
 * Every atom the count leaves out is named, with why (at most three by name).
 */
export function atomsLine(stats: AssembleStats): string {
  const parts = [`${stats.fromCache} from cache`]
  const skipped = stats.skipped ?? []
  if (skipped.length > 0) {
    const reasons = [...new Set(skipped.map((s) => s.reason))]
    const shown = skipped.slice(0, 3).map((s) => (reasons.length > 1 ? `${s.id} (${s.reason})` : s.id))
    const more = skipped.length > 3 ? ` and ${skipped.length - 3} more` : ''
    parts.push(`${skipped.length} skipped: ${shown.join(', ')}${more}${reasons.length === 1 ? ` (${reasons[0] as string})` : ''}`)
  }
  if (stats.failed) parts.push(`${stats.failed} failed (see the errors above)`)
  return `${stats.compiled}/${stats.atoms} atoms compiled (${parts.join('; ')})`
}

export interface AssembleResult {
  /** No diagnostic is an error. */
  readonly ok: boolean
  /** The served folder: POSIX path → bytes. Filled as far as the build got, even when not `ok`. */
  readonly files: Map<string, Uint8Array>
  readonly diagnostics: readonly AssembleDiagnostic[]
  readonly stats: AssembleStats
  readonly ms: number
}

const enc = new TextEncoder()
const json = (value: unknown): Uint8Array => enc.encode(JSON.stringify(value, null, 2))
const hexOf = (hash: string): string => hash.replace(/^sha256:/, '')

/** Every name a block atom answers to in a receipt: its id, its manifest name, and its short forms (`blockTypeNames`). */
export function blockNames(atom: Pick<CompiledAtom, 'id' | 'manifest'>): string[] {
  return blockTypeNames(atom.id, atom.manifest)
}

/**
 * A placed block's `definition.origins` (block-manifest): the origins its own
 * code reaches. A malformed declaration is an error, not a guess.
 */
function declaredOrigins(atom: CompiledAtom, diagnostics: AssembleDiagnostic[]): { origins?: BlockOrigins } {
  const definition = atom.manifest?.['definition']
  const origins = isRecord(definition) ? definition['origins'] : undefined
  if (origins === undefined) return {}
  const result = safeParseBlockOrigins(origins)
  if (result.ok) return { origins: result.value }
  for (const issue of result.issues) {
    diagnostics.push({
      severity: 'error',
      code: 'BLOCK_ORIGIN_INVALID',
      message: `${atomLabel(atom)}: definition.origins — ${issue}`,
      path: atom.relPath,
    })
  }
  return {}
}

/**
 * The app's title (`plan.json` `title`), or `''`. The engine does not make one
 * up from the pack id: a humanised id ("Cafe Menu") was a word the app never
 * wrote.
 */
function titleOf(plan: unknown): string {
  return textOf(plan, 'title') ?? ''
}

/**
 * The app's title template (`plan.json` `titleTemplate`, receipt §1.1):
 * exactly one `%s`, `%%` for a `%`. Any other is an error, and no template
 * is used.
 */
function titleTemplateOf(plan: unknown, diagnostics: AssembleDiagnostic[]): string | undefined {
  const raw = isRecord(plan) ? plan['titleTemplate'] : undefined
  if (raw === undefined) return undefined
  if (isTitleTemplate(raw)) return raw
  diagnostics.push({
    severity: 'error',
    code: 'PLAN_TITLE_TEMPLATE_INVALID',
    message: `plan.json "titleTemplate" is ${JSON.stringify(raw)}: it holds exactly one %s, which the page's title replaces, and writes a % as %%`,
    path: 'app/plan.json',
  })
  return undefined
}

/** A receipt member that is text as it stands — not empty, no expression — trimmed. */
function literalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' && !value.includes('{{') ? value.trim() : undefined
}

/**
 * `keys` in the app's navigation order: the entry page first (the navbar's
 * logo links to it), then each page `navigation.json` links to, in document
 * order (`surfaceKey`, or a root-relative `href`), then the rest as the app
 * lists them.
 */
export function navigationOrder(navigation: unknown, entry: string, keys: readonly string[]): string[] {
  const linked: string[] = [entry]
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!isRecord(node)) return
    const key =
      typeof node['surfaceKey'] === 'string'
        ? node['surfaceKey']
        : typeof node['href'] === 'string' && /^\/(?!\/)/.test(node['href'])
          ? node['href'].replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '') || entry
          : undefined
    if (key !== undefined) linked.push(key)
    for (const v of Object.values(node)) walk(v)
  }
  walk(navigation)
  const ordered = [...new Set(linked)].filter((k) => keys.includes(k))
  return [...ordered, ...keys.filter((k) => !ordered.includes(k))]
}

/** A non-empty trimmed string member of `doc`, or undefined. */
function textOf(doc: unknown, key: string): string | undefined {
  const v = isRecord(doc) ? doc[key] : undefined
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

/**
 * `plan.json` `messages`: the app's words, a flat map from message id to
 * string (envelope §2). An entry that is not a string is dropped with an
 * error (MESSAGES_INVALID) — a nested object or a number would only ever
 * read the fallback, silently. Absent: undefined.
 */
function messagesOf(plan: unknown, diagnostics: AssembleDiagnostic[]): Record<string, string> | undefined {
  const raw = isRecord(plan) ? plan['messages'] : undefined
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    diagnostics.push({
      severity: 'error',
      code: 'MESSAGES_INVALID',
      message: 'messages must be an object from message id to string',
      path: 'app/plan.json',
    })
    return undefined
  }
  const out: Record<string, string> = {}
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value === 'string') {
      out[id] = value
      // A plural the runner cannot pick is written as its text (envelope §2.1).
      for (const problem of pluralProblems(value)) {
        diagnostics.push({ severity: 'error', code: 'MESSAGES_INVALID', message: `messages["${id}"]: ${problem}`, path: 'app/plan.json' })
      }
      continue
    }
    diagnostics.push({
      severity: 'error',
      code: 'MESSAGES_INVALID',
      message: `messages["${id}"] is not a string; the runner reads its fallback`,
      path: 'app/plan.json',
    })
  }
  return out
}

/**
 * The app's resolved appearance with each of its fonts' metric-matched
 * stand-in named in its stacks (fonts.ts `withFontFallbacks`), in whichever
 * of the shapes it came.
 */
function withFallbackStacks(doc: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!doc) return doc
  return isRecord(doc['config']) ? { ...doc, config: withFontFallbacks(doc['config']) } : withFontFallbacks(doc)
}

/**
 * The receipt as served, with the appearance the page wears: its own,
 * resolved to the whole configuration (`{ config }`); none, when it wears the
 * app's (the runner then hands the renderer the app's); as written, when its
 * theme could not be found. Unchanged: the same object.
 */
function withPageAppearance(receipt: Record<string, unknown>, wears: PageAppearance | undefined): Record<string, unknown> {
  if (wears?.wears === 'own') return { ...receipt, appearance: { config: wears.config } }
  if (wears?.wears === 'app' && receipt['appearance'] !== undefined) {
    const { appearance: _appearance, ...rest } = receipt
    return rest
  }
  return receipt
}

/** What an app in several languages adds to its pages (envelope §2.3); empty for a single-language app. */
interface LocaleInputs {
  /** Each page's receipt for one locale (`<key>.<lang>`), as a page of that key. */
  readonly pages: Page[]
  /** lang → page key → its receipt in that locale. */
  readonly receipts: Map<string, Map<string, Page>>
  /** `localeReceiptFiles`: lang → page key → envelope path. */
  readonly receiptFiles: Record<string, Record<string, string>>
  readonly catalogues: Record<string, Record<string, string>>
  readonly addresses: AddressTable
}

/**
 * The per-locale receipts (`app/surfaces/<key>.<lang>.receipt.json`), the
 * catalogues (`app/messages/<lang>.json`, their plurals checked) and the
 * address table of an app with locales. The table's and the declaration's
 * own errors are the pack validation's (APP_LOCALES_INVALID, APP_ADDRESS_CONFLICT).
 */
function localeInputsOf(
  folder: SourcePack['folder'],
  locales: LocaleDeclaration | undefined,
  pages: readonly Page[],
  surfaceOrder: readonly string[],
  entry: string,
  diagnostics: AssembleDiagnostic[]
): LocaleInputs {
  const out: LocaleInputs = { pages: [], receipts: new Map(), receiptFiles: {}, catalogues: {}, addresses: {} }
  if (!locales) return out
  for (const lang of locales.locales) {
    const own = new Map<string, Page>()
    for (const page of pages) {
      const path = `app/surfaces/${page.key}.${lang}.receipt.json`
      const bytes = folder.files.get(path)
      if (!bytes) continue
      const value = jsonOf(folder, path)
      if (value instanceof Error || !isRecord(value) || !Array.isArray(value['blocks'])) {
        diagnostics.push({ severity: 'error', code: 'RECEIPT_INVALID', message: value instanceof Error ? `not JSON: ${value.message}` : 'a receipt is an object with a "blocks" array', path })
        continue
      }
      const localePage: Page = { key: `${page.key}.${lang}`, path, bytes, receipt: value }
      own.set(page.key, localePage)
      out.pages.push(localePage)
      ;(out.receiptFiles[lang] ??= {})[page.key] = `surfaces/${page.key}.${lang}.receipt.json`
    }
    if (own.size > 0) out.receipts.set(lang, own)
    const words = jsonOf(folder, `app/messages/${lang}.json`)
    const catalogue: Record<string, string> = {}
    if (isRecord(words)) {
      for (const [id, text] of Object.entries(words)) {
        if (typeof text !== 'string') {
          diagnostics.push({ severity: 'error', code: 'MESSAGES_INVALID', message: `messages["${id}"] is not a string`, path: `app/messages/${lang}.json` })
          continue
        }
        catalogue[id] = text
        for (const problem of pluralProblems(text)) diagnostics.push({ severity: 'error', code: 'MESSAGES_INVALID', message: `messages["${id}"]: ${problem}`, path: `app/messages/${lang}.json` })
      }
    }
    out.catalogues[lang] = catalogue
  }
  const pathOf = (key: string): Readonly<Record<string, string>> | undefined => receiptPathOf(pages.find((p) => p.key === key)?.receipt)
  return { ...out, addresses: addressTable(locales, [...new Set(surfaceOrder)], entry, pathOf).addresses }
}

/** The ids the runner and the renderer read (their own words), and the prefix of a block's own (`ui.*`). */
const ENGINE_WORDS: ReadonlySet<string> = new Set<string>([...RUNNER_MESSAGE_IDS, ...RENDERER_MESSAGE_IDS])

/**
 * The words of every page in every locale (envelope §2.3): per page, the ids
 * its receipt (in that locale, as drawn in the layout) reads by a literal
 * `t('<id>')`, the engine's own ids and a block's own (`ui.*`), from the
 * locale's catalogue over the default's. `dynamic` lists the pages that read
 * a word by an id they compute: those fetch the whole catalogue as well.
 */
function pageWordsOf(
  localed: LocaleInputs,
  locales: LocaleDeclaration | undefined,
  pages: readonly Page[],
  drawn: (key: string, receipt: unknown) => unknown
): { files: Record<string, Record<string, string>>; bodies: Map<string, Record<string, string>>; dynamic: string[] } {
  const out = { files: {} as Record<string, Record<string, string>>, bodies: new Map<string, Record<string, string>>(), dynamic: [] as string[] }
  if (!locales) return out
  const dynamic = new Set<string>()
  for (const lang of locales.locales) {
    const words = catalogueFor(localed.catalogues, locales, lang)
    for (const page of pages) {
      const receipt = localed.receipts.get(lang)?.get(page.key)?.receipt ?? page.receipt
      const text = JSON.stringify(drawn(page.key, receipt) ?? receipt)
      const literal = new Set([...text.matchAll(LITERAL_T)].map((m) => m[2] as string))
      if (COMPUTED_T.test(text)) dynamic.add(page.key)
      const own: Record<string, string> = {}
      for (const [id, word] of Object.entries(words)) if (literal.has(id) || ENGINE_WORDS.has(id) || id.startsWith('ui.')) own[id] = word
      const path = `messages/${lang}/${page.key}.json`
      ;(out.files[lang] ??= {})[page.key] = path
      out.bodies.set(path, own)
    }
  }
  out.dynamic = [...dynamic].sort()
  return out
}

/** `t('<id>')` / `t("<id>")` in a receipt's JSON text (its quotes escaped as JSON writes them). */
const LITERAL_T = /\bt\(\s*(\\?['"])([^'"\\]+)\1/g
/** A `t(` whose id is not a literal. */
const COMPUTED_T = /\{\{[^}]*\bt\(\s*(?![\s\\]*['"])/

/** The locales in the order their sections are written: the default first, then `locales` order. */
function orderedLocales(locales: LocaleDeclaration): string[] {
  return [locales.defaultLocale, ...locales.locales.filter((l) => l !== locales.defaultLocale)]
}

/**
 * A page's address in a locale as the runner's router writes it (runner
 * router.ts): `<base><address>` under path routing, `#/<address>` under hash
 * routing; an address that is not a page's key in the table is written as given.
 */
function localeHref(addresses: AddressTable, lang: string, key: string, byPath: boolean, base: string): string {
  const own = addresses[lang]?.[key]
  const address = (own ?? key).replace(/^\/+|\/+$/g, '')
  if (!byPath) return `#/${address}`
  const root = base.replace(/\/+$/, '')
  return address === '' ? `${root}/` : `${root}/${address}/`
}

/**
 * The address table as the inline scripts read it (`{ <address>: <key> }`):
 * every locale's addresses without their end slashes, those of the locale
 * drawn naming their page, every other naming none (`''`).
 */
function addressKeysOf(addresses: AddressTable, lang: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [l, row] of Object.entries(addresses)) for (const [key, address] of Object.entries(row)) out[address.replace(/\/+$/, '')] = l === lang ? key : ''
  return out
}

/** `hreflang` alternates of a page: one per locale, then `x-default`, the default locale's. */
function hreflangsOf(locales: LocaleDeclaration, url: (lang: string) => string | undefined): { hreflang: string; href: string }[] {
  const out: { hreflang: string; href: string }[] = []
  for (const lang of locales.locales) {
    const href = url(lang)
    if (href !== undefined) out.push({ hreflang: lang, href })
  }
  const fallback = url(locales.defaultLocale)
  if (fallback !== undefined) out.push({ hreflang: 'x-default', href: fallback })
  return out
}

/** The app's layout in its source, and as the envelope serves it (`project.json` `layoutReceiptFile`). */
export const LAYOUT_FILE = 'app/layout.receipt.json'
export const LAYOUT_RECEIPT_FILE = 'layout.receipt.json'

/**
 * The app's layout (receipt §4), read like a page: absent, none. One that is
 * not a receipt, or does not hold exactly one bare page slot
 * (APP_LAYOUT_SLOT), is an error, and no page is drawn in it.
 */
function layoutOf(folder: SourcePack['folder'], diagnostics: AssembleDiagnostic[], reported: ReadonlySet<string | undefined>): Page | undefined {
  const bytes = folder.files.get(LAYOUT_FILE)
  if (!bytes) return undefined
  const value = jsonOf(folder, LAYOUT_FILE)
  if (value instanceof Error || !isRecord(value) || !Array.isArray(value['blocks'])) {
    if (!reported.has(LAYOUT_FILE)) {
      diagnostics.push({
        severity: 'error',
        code: 'RECEIPT_INVALID',
        message: value instanceof Error ? `not JSON: ${value.message}` : 'a layout is an object with a "blocks" array',
        path: LAYOUT_FILE,
      })
    }
    return undefined
  }
  const problems = layoutSlotProblems(value)
  if (problems.length > 0) {
    if (!reported.has(LAYOUT_FILE)) diagnostics.push({ severity: 'error', code: 'APP_LAYOUT_SLOT', message: `${LAYOUT_FILE}: ${problems.join('; ')}`, path: LAYOUT_FILE })
    return undefined
  }
  return { key: 'layout', path: LAYOUT_FILE, bytes, receipt: value }
}

/**
 * The receipt as served, without its authoring information: `knowledge` (what
 * the page is for, the patterns it exercises) stays in the app's source; no
 * runner reads it and no visitor needs it (receipt §1). Unchanged: the same object.
 */
function withoutAuthoring(receipt: Record<string, unknown>): Record<string, unknown> {
  if (receipt['knowledge'] === undefined) return receipt
  const { knowledge: _knowledge, ...served } = receipt
  return served
}

/** The app's icon (`appearance` `brand.favicon`), as the documents link it (favicon.ts); a problem is FAVICON_INVALID. */
function faviconFor(config: Record<string, unknown> | undefined, files: ReadonlyMap<string, Uint8Array>, diagnostics: AssembleDiagnostic[]): string | undefined {
  const brand = isRecord(config) ? config['brand'] : undefined
  const { href, problem } = faviconOf(isRecord(brand) ? brand['favicon'] : undefined, files)
  if (problem) diagnostics.push({ severity: 'error', code: 'FAVICON_INVALID', message: problem, path: 'app/definitions/appearance.json' })
  return href
}

/** The folder whose files a build copies, as they are, to the root of the served folder. */
export const PUBLIC_DIR = 'public/'

/**
 * The app's `public/` files as served (`public/favicon.ico` → `favicon.ico`),
 * each with its bytes: those `pwf validate` does not already refuse (a path
 * the build writes, a file that is script — pwpack-format §1.4).
 */
function publicFilesOf(appFiles: ReadonlyMap<string, Uint8Array>, pageKeys: readonly string[], localePrefixes: readonly string[] = []): [string, Uint8Array][] {
  const out: [string, Uint8Array][] = []
  for (const path of [...appFiles.keys()].filter((p) => p.startsWith(PUBLIC_DIR)).sort()) {
    const rel = path.slice(PUBLIC_DIR.length)
    const bytes = appFiles.get(path) as Uint8Array
    if (rel === '' || publicReservedReason(rel, pageKeys, localePrefixes) || publicScriptReason(rel, bytes)) continue
    out.push([rel, bytes])
  }
  return out
}

/**
 * Copies the public files into the served folder, byte for byte. One that
 * would replace a file the build wrote is an error (APP_PUBLIC_RESERVED),
 * never a silent overwrite.
 */
function copyPublic(publicFiles: readonly [string, Uint8Array][], files: Map<string, Uint8Array>, diagnostics: AssembleDiagnostic[]): void {
  for (const [rel, bytes] of publicFiles) {
    if (files.has(rel) || rel === 'publish.json') {
      diagnostics.push({
        severity: 'error',
        code: 'APP_PUBLIC_RESERVED',
        message: `${PUBLIC_DIR}${rel} would be served at /${rel}, which the build writes itself; rename or move it`,
        path: `${PUBLIC_DIR}${rel}`,
      })
      continue
    }
    files.set(rel, bytes)
  }
}

function atomLabel(atom: CompiledAtom): string {
  return atom.source.origin === 'app' ? atom.id : `${atom.id} (${atom.source.id}@${atom.source.version})`
}

const EMPTY_STATS: AssembleStats = { pages: 0, blocks: 0, engines: 0, atoms: 0, compiled: 0, fromCache: 0, failed: 0 }

/** Assembles the pwapp for the app folder at `root`. */
export async function assemblePwapp(root: string, options: AssembleOptions = {}): Promise<AssembleResult> {
  const started = performance.now()
  const diagnostics: AssembleDiagnostic[] = []
  const files = new Map<string, Uint8Array>()
  const done = (stats: AssembleStats): AssembleResult => {
    const sorted = sortDiagnostics(diagnostics)
    return { ok: !hasErrors(sorted), files, diagnostics: sorted, stats, ms: Math.round(performance.now() - started) }
  }

  const sources = await loadSources(root, options.packMemo)
  diagnostics.push(...sources.diagnostics)
  diagnostics.push(...engineRangeDiagnostics(sources, options.engineVersion ?? engineVersion()))
  const { app, identity } = sources
  if (!app || !identity) return done(EMPTY_STATS)
  if (!identity.app) {
    diagnostics.push({
      severity: 'error',
      code: 'NOT_AN_APP',
      message: 'pwpack.json declares no "app" member, so this folder is a pack, not an app — there is nothing to run',
      path: 'pwpack.json',
    })
    return done(EMPTY_STATS)
  }

  // ── pages ────────────────────────────────────────────────────────
  const reported = new Set(diagnostics.map((d) => d.path))
  const pages: Page[] = []
  // The app's own not-found page (`app.notFound`) and sign-in screen
  // (`app.signIn`) are read like pages and served like them, but they are no
  // routes: not in `surfaceOrder`, not in the derived navigation.
  const { keys, notFoundKey, signInKey } = servedPageKeys(identity.app)
  for (const key of keys) {
    const path = `app/surfaces/${key}.receipt.json`
    const bytes = app.folder.files.get(path)
    const value = jsonOf(app.folder, path)
    if (!bytes) {
      if (!reported.has(path)) {
        diagnostics.push({
          severity: 'error',
          code: 'RECEIPT_MISSING',
          message: `page "${key}" is in ${key === notFoundKey ? 'app.notFound' : key === signInKey ? 'app.signIn' : 'app.surfaceOrder'} but ${path} does not exist`,
          path,
        })
      }
      continue
    }
    if (value instanceof Error || !isRecord(value) || !Array.isArray(value['blocks'])) {
      diagnostics.push({
        severity: 'error',
        code: 'RECEIPT_INVALID',
        message: value instanceof Error ? `not JSON: ${value.message}` : 'a receipt is an object with a "blocks" array',
        path,
      })
      continue
    }
    pages.push({ key, path, bytes, receipt: value })
  }
  // `pages` is everything served; `routes` is what an address can name.
  const notFoundPage = notFoundKey === undefined ? undefined : pages.find((p) => p.key === notFoundKey)
  const signInPage = signInKey === undefined ? undefined : pages.find((p) => p.key === signInKey)
  const routes = pages.filter((p) => p !== notFoundPage && p !== signInPage)
  const entry = identity.app.entry
  // Under path routing a route is a folder of the served app (`<key>/index.html`).
  if ((options.router ?? 'hash') !== 'hash') {
    for (const page of routes) {
      // A page in a folder (`docs/intro`) is served under its first segment's folder.
      if (page.key !== entry && SERVED_FOLDERS.includes(page.key.split('/')[0] as string)) {
        diagnostics.push({
          severity: 'error',
          code: 'PAGE_KEY_RESERVED',
          message: `page "${page.key}" is named like a folder of the served app (${SERVED_FOLDERS.join(', ')}); under path routing its address would be that folder. Rename the page.`,
          path: page.path,
        })
      }
    }
  }
  // ── the layout (receipt §4): the receipt every page is drawn in ──
  const layoutPage = layoutOf(app.folder, diagnostics, reported)
  // ── the app's languages (envelope §2.3) ──
  const locales = localesOf(jsonOf(app.folder, 'app/plan.json'))
  const localed = localeInputsOf(app.folder, locales, pages, identity.app.surfaceOrder, entry, diagnostics)
  /**
   * A page's receipt assembled into the layout (envelope §4 step 2), the way
   * the runner assembles it: what the first frame, the page hints and the
   * policy read. The envelope serves page and layout apart.
   */
  const inLayout = (key: string, receipt: unknown, layout: unknown, blocks?: readonly BlockManifestEntry[]): { receipt: unknown; problems: readonly { kind: string; id: string; message: string }[] } => {
    if (!isRecord(layout) || !isRecord(receipt) || !Array.isArray(receipt['blocks'])) return { receipt, problems: [] }
    type Receipt = Parameters<typeof assemblePage>[1]
    type Blocks = NonNullable<Parameters<typeof assemblePage>[2]['blocks']>
    return assemblePage(layout as unknown as Receipt, receipt as unknown as Receipt, {
      key,
      entry,
      notFoundPage: key === notFoundKey,
      ...(blocks ? { blocks: blocks as unknown as Blocks } : {}),
    })
  }
  if (!identity.app.surfaceOrder.includes(entry)) {
    diagnostics.push({ severity: 'error', code: 'ENTRY_NOT_A_PAGE', message: `app.entry "${entry}" is not in app.surfaceOrder`, path: 'pwpack.json' })
  }

  // ── definitions ──────────────────────────────────────────────────
  const definition = (name: string): unknown => {
    const path = `app/definitions/${name}.json`
    const value = jsonOf(app.folder, path)
    if (value instanceof Error) {
      diagnostics.push({ severity: 'error', code: 'DEFINITION_INVALID', message: `not JSON: ${value.message}`, path })
      return undefined
    }
    return value
  }
  const navigationDoc = definition('navigation')
  const appearanceDoc = definition('appearance')
  const connectionsDoc = definition('connections')
  const authDoc = definition('auth')
  // Each own-records source carries its type's field names, so a write sends
  // those only (host/record-fields.ts).
  const entitiesDoc = definition('entities')
  const recordFields = declaredRecordFields(entitiesDoc)
  // ...and says whether only a session can be answered for it, from the
  // declared access rules (host/session-sources.ts).
  const entityDeclarations = entityDeclarationsOf(entitiesDoc)
  const authDeclaration = authDeclarationOf(authDoc)
  const plan = jsonOf(app.folder, 'app/plan.json')

  // ── compile ──────────────────────────────────────────────────────
  const all: SourcePack[] = [app, ...sources.packs]
  const cache = options.cache ?? createCompileCache(options.cacheDir === undefined ? join(root, PWF_DIR, 'build-cache') : options.cacheDir)
  const atoms = await compileSources(all, cache)

  // ── themes ───────────────────────────────────────────────────────
  const themes: ThemeAtom[] = []
  for (const source of all) {
    for (const ref of source.validation.atoms) {
      if (ref.kind !== 'ui-appearance') continue
      const theme = themeAtomOf(ref.id, jsonOf(source.folder, ref.relPath), source.label || source.id)
      if (theme) themes.push(theme)
    }
  }
  const appearance = withFallbackStacks(resolveAppearance(appearanceDoc, themes, diagnostics))
  const config = appearanceConfigOf(appearance)
  // Each page's own appearance (its receipt's `appearance`), resolved the same
  // way: a page that names a theme wears it (theme.ts resolvePageAppearance).
  const appTheme = { config, theme: namedThemeOf(appearanceDoc, themes) }
  const pageAppearance = new Map<string, PageAppearance>()
  for (const page of pages) {
    pageAppearance.set(page.key, resolvePageAppearance(page.receipt['appearance'], appTheme, themes, diagnostics, page.path))
  }
  const pageThemes: PageTheme[] = []
  for (const page of pages) {
    const own = pageAppearance.get(page.key)
    if (own?.wears === 'own') pageThemes.push({ key: page.key, config: own.config })
  }

  // ── blocks ───────────────────────────────────────────────────────
  const byName = new Map<string, CompiledAtom[]>()
  for (const atom of atoms) {
    if (atom.kind !== 'block') continue
    for (const name of blockNames(atom)) {
      const list = byName.get(name) ?? []
      if (!list.includes(atom)) list.push(atom)
      byName.set(name, list)
    }
  }
  // Every receipt is checked against its blocks' manifests here, at build
  // time, not in the visitor's browser: a prop the manifest does not declare,
  // a value that does not fit its declared shape (the runtime renders it
  // as written, with a developer warning), a template on a literal-only prop. Warnings.
  // Which block a type names: the one rule of @pwfabric/pack resolveBlockType
  // (an id or a manifest name first, a short name only when one block has it).
  const named = atoms.filter((a) => a.kind === 'block').map((a) => ({ atom: a, id: a.id, ...(a.manifest ? { manifest: a.manifest } : {}) }))
  const propCatalog = new Map<string, { atomId: string; props: NonNullable<ReturnType<typeof blockPropDescriptors>> }>()
  for (const name of byName.keys()) {
    const hit = resolveBlockType(name, named)
    if (!hit || 'ambiguous' in hit) continue
    const props = blockPropDescriptors(hit.atom.manifest)
    if (props) propCatalog.set(name, { atomId: hit.id, props })
  }
  for (const page of [...pages, ...localed.pages, ...(layoutPage ? [layoutPage] : [])]) {
    for (const issue of checkReceiptBlockProps(page.receipt, propCatalog, page.path)) {
      diagnostics.push({ severity: 'warning', code: issue.code, message: issue.message, path: page.path })
    }
  }
  for (const page of [...pages, ...localed.pages]) {
    // A block id is unique within its page (receipt §2) — the page as drawn,
    // in the layout — as `pwf validate` says too; so is a data source id.
    const drawn = inLayout(page.key, page.receipt, layoutPage?.receipt)
    for (const issue of checkBlockIds({ path: page.path, receipt: drawn.receipt })) diagnostics.push({ severity: 'error', code: issue.code, message: issue.message, path: page.path })
    for (const problem of drawn.problems) {
      if (problem.kind === 'source') diagnostics.push({ severity: 'error', code: 'SOURCE_ID_DUPLICATE', message: `${problem.message} (${LAYOUT_FILE})`, path: page.path })
    }
  }

  const used = new Set<CompiledAtom>()
  const placedBlocks: { atomId: string; origins?: BlockOrigins }[] = []
  const blockManifest: BlockManifestEntry[] = []
  const modules = new Map<string, Uint8Array>()
  for (const [type, page] of blockTypeFirstUses([...pages, ...localed.pages, ...(layoutPage ? [layoutPage] : [])])) {
    // The layout's page slot is the format's, no block (receipt §4).
    if (type === PAGE_SLOT_TYPE) continue
    const hit = resolveBlockType(type, named)
    if (hit && 'ambiguous' in hit) {
      diagnostics.push({ severity: 'error', code: BLOCK_TYPE_AMBIGUOUS, message: ambiguousBlockTypeMessage(type, page.key, hit.ambiguous.map((b) => b.id)), path: page.path })
      continue
    }
    const atom = hit?.atom
    const shadowed = hit ? hit.shadowed.map((b) => b.atom) : []
    if (!atom) {
      // The same finding, worded the same, as `pwf validate` (@pwfabric/pack checkBlockTypes).
      const issue = unknownBlockTypeIssue(type, page)
      diagnostics.push({ severity: 'error', code: issue.code, message: issue.message, path: page.path })
      continue
    }
    if (!used.has(atom)) placedBlocks.push({ atomId: atom.id, ...declaredOrigins(atom, diagnostics) })
    used.add(atom)
    if (shadowed.length > 0) {
      diagnostics.push({
        severity: 'info',
        code: 'BLOCK_TYPE_SHADOWED',
        message: `block type "${type}" resolves to ${atomLabel(atom)}; also defined by ${shadowed.map(atomLabel).join(', ')}`,
        path: page.path,
      })
    }
    if (!atom.code || !atom.hash) {
      diagnostics.push({
        severity: 'error',
        code: 'BLOCK_NOT_COMPILED',
        message: `block type "${type}" (${atomLabel(atom)}) did not compile (see the compile errors reported for ${atom.relPath})`,
        path: page.path,
      })
      continue
    }
    const file = `blocks/${moduleFileName(type, hexOf(atom.hash))}`
    modules.set(file, enc.encode(atom.code))
    const props = manifestProps(atom.manifest)
    blockManifest.push({
      blockType: type,
      moduleUrl: file,
      integrity: hexOf(atom.hash),
      publisher: publisherOf(atom.source.id),
      publisherVerified: false,
      definition: props ? { name: type, props } : { name: type },
    })
  }

  // ── engines ──────────────────────────────────────────────────────
  const connections = buildConnections(connectionsDoc, diagnostics)
  // In connection order; a provider facet's entry is filled once its vendor's module is built.
  const engineSlots: (EngineManifestEntry | undefined)[] = []
  // A compiled provider facet goes into its vendor's ONE module (compile.ts compileProviderBundle).
  const vendors = new Map<string, { source: SourcePack; vendor: string; facets: { slot: number; connection: string; atom: CompiledAtom; domain: string }[] }>()
  for (const conn of connections?.connections ?? []) {
    const name = conn['name'] as string
    const wanted = typeof conn['connector'] === 'string' ? conn['connector'] : name
    const atom = atoms.find(
      (a) => (a.kind === 'connector' || a.kind === 'provider') && a.manifest?.['connection'] === wanted
    )
    if (!atom) continue
    used.add(atom)
    const kind = atom.kind as 'connector' | 'provider'
    const facet = kind === 'provider' ? providerFacetOf(atom.relPath) : undefined
    if (facet && atom.code && atom.hash) {
      const key = `${atom.source.id}\u0000${facet.vendor}`
      const group = vendors.get(key) ?? { source: atom.source, vendor: facet.vendor, facets: [] }
      group.facets.push({ slot: engineSlots.length, connection: name, atom, domain: facet.domain })
      vendors.set(key, group)
      engineSlots.push(undefined)
    } else if (atom.code && atom.hash) {
      const file = `engines/${moduleFileName(atom.id, hexOf(atom.hash))}`
      modules.set(file, enc.encode(atom.code))
      engineSlots.push({ connection: name, atomId: atom.id, kind, moduleUrl: file, integrity: hexOf(atom.hash) })
    } else if (atom.manifest?.['engine'] !== undefined) {
      engineSlots.push({ connection: name, atomId: atom.id, kind, engine: atom.manifest['engine'] })
    } else if (atom.status === 'failed') {
      diagnostics.push({
        severity: 'warning',
        code: 'ENGINE_NOT_COMPILED',
        message: `connection "${name}": engine ${atomLabel(atom)} did not compile, so its panels fall back to sample data`,
        path: 'app/definitions/connections.json',
      })
    }
  }
  for (const key of [...vendors.keys()].sort()) {
    const { source, vendor, facets } = vendors.get(key) as NonNullable<ReturnType<typeof vendors.get>>
    const bundle = await compileProviderBundle(source, vendor, facets.map((f) => f.domain), cache)
    if (!bundle.ok || !bundle.code || !bundle.hash) {
      // Each facet compiled on its own, so this is the shared module's own failure: say it, drop its connections.
      diagnostics.push(...bundle.diagnostics.map((d) => (d.severity === 'error' ? { ...d, severity: 'warning' as const } : d)))
      for (const f of facets) {
        diagnostics.push({
          severity: 'warning',
          code: 'ENGINE_NOT_COMPILED',
          message: `connection "${f.connection}": the module of provider "${vendor}" (${atomLabel(f.atom)}) did not compile, so its panels fall back to sample data`,
          path: 'app/definitions/connections.json',
        })
      }
      continue
    }
    const file = `engines/${moduleFileName(vendor, hexOf(bundle.hash))}`
    modules.set(file, enc.encode(bundle.code))
    for (const f of facets) {
      engineSlots[f.slot] = { connection: f.connection, atomId: f.atom.id, kind: 'provider', moduleUrl: file, integrity: hexOf(bundle.hash), export: f.domain }
    }
  }
  const engineManifest: EngineManifestEntry[] = engineSlots.filter((e): e is EngineManifestEntry => e !== undefined)

  // ── atom diagnostics ─────────────────────────────────────────────
  // The app's own atoms and the atoms it uses speak at full volume; an unused
  // atom of a pinned pack cannot break this app, so its errors are warnings.
  for (const atom of atoms) {
    const loud = atom.source.origin === 'app' || used.has(atom)
    for (const d of atom.diagnostics) {
      const engineDegrades = atomKindMeta(atom.kind).onFailure === 'degrade'
      diagnostics.push(loud && !engineDegrades ? d : d.severity === 'error' ? { ...d, severity: 'warning' } : d)
    }
  }

  // ── the served folder ────────────────────────────────────────────
  const runtime = options.runtime ?? (await loadRuntimeAssets())
  const title = titleOf(plan)
  const titleTemplate = titleTemplateOf(plan, diagnostics)
  const locale = isRecord(plan) && typeof plan['locale'] === 'string' ? plan['locale'] : undefined
  // The app's words (`plan.json` `messages`), carried as they are: the runner
  // reads every word it draws there first (envelope §2).
  const messages = messagesOf(plan, diagnostics)
  // The app in a sentence (`app/plan.json` `description`): every page's
  // <meta name="description"> that states none of its own.
  const appDescription = textOf(plan, 'description')
  // Where the app is published (`plan.json` `origin`) and the picture a link
  // preview shows (`image`): each page's canonical address and Open Graph tags.
  const declaredOrigin = textOf(plan, 'origin')
  const origin = publicOriginOf(declaredOrigin)
  if (declaredOrigin !== undefined && (origin === undefined || new URL(declaredOrigin).pathname.replace(/\/+$/, '') !== '')) {
    diagnostics.push({
      severity: 'error',
      code: 'ORIGIN_INVALID',
      message: `plan.json "origin" is "${declaredOrigin}": it is the app's public origin, scheme and host only (https://example.com); the path the app is served under is the build's --base`,
      path: 'app/plan.json',
    })
  }
  const image = textOf(plan, 'image')
  if (image !== undefined && !/^https?:\/\//i.test(image) && !app.folder.files.has(image.replace(/^\.?\//, ''))) {
    diagnostics.push({
      severity: 'error',
      code: 'IMAGE_INVALID',
      message: `plan.json "image" is "${image}": it is an http(s) address or a file of the app (media/<file>), and the app has no such file`,
      path: 'app/plan.json',
    })
  }
  // What the plan asks of the site beyond its pages (plan-site.ts): scripts,
  // response headers, redirects. Each is checked; a malformed one is an error.
  const planScripts = planScriptsOf(plan, diagnostics)
  // The app's public files, as served: listed in project.json, copied last.
  const publicFiles = publicFilesOf(app.folder.files, keys, locales ? locales.locales.filter((l) => l !== locales.defaultLocale).map(localePrefix) : [])
  // The app's icon: every document links it.
  const favicon = faviconFor(config, app.folder.files, diagnostics)
  // The visitor's colour-scheme choice, applied before the first paint
  // (appearance §4.1) — only where there is one to make: the app, or one of
  // its pages, wears the `system` policy. Keyed like the runner keys storage
  // (envelope §4): `project.json` `id`.
  const wearsSystem = [config, ...pageThemes.map((p) => p.config)].some((c) => resolveAppearanceMode(c).policy === 'system')
  const schemeScript = wearsSystem ? colorSchemeScript(identity.id) : undefined
  // An app that requires sign-in shows a visitor the gate first; whether the
  // renderer is ever needed is up to the visitor, so it is not preloaded.
  const gated = isRecord(authDoc) && authDoc['required'] === true

  // ── the runtime files, content-hashed (cached as immutable: _headers) ──
  // The app's own fonts, of its theme and of every page's own (pwapp-format §2.3):
  // served hashed under assets/fonts/, declared in the theme stylesheet.
  const fontAssets = fontAssetsOf(fontsOf([config, ...pageThemes.map((p) => p.config)]), app.folder.files, bodyFontOf(config))
  for (const u of fontAssets.unreadable) {
    diagnostics.push({ severity: 'warning', code: 'FONT_METRICS_UNREADABLE', message: unreadableMetricsMessage(u), path: u.src ?? 'app/definitions/appearance.json' })
  }
  const themeCss = enc.encode(buildThemeCss(config, pageThemes, fontAssets.css))
  const assets0 = {
    embed: hashedName('assets/embed.js', runtime.embedJs),
    runner: hashedName('assets/runner.js', runtime.runnerJs),
    theme: hashedName('assets/theme.css', themeCss),
  }
  // ── what each page needs first (shell and boot hints) ──
  const moduleOf = new Map(blockManifest.map((b) => [b.blockType, b.moduleUrl]))
  // The receipt as it will be served: its media slots filled.
  const media = collectMedia(app.folder, diagnostics)
  const servedReceiptOf = (page: Page, slotKey = page.key): unknown => {
    const filled = fillMediaSlots(page.bytes, media.slots.get(slotKey))
    if (!filled) return page.receipt
    try {
      return JSON.parse(new TextDecoder().decode(filled)) as unknown
    } catch {
      return page.receipt
    }
  }
  const hintsOf = (page: Page, lang?: string): PageHints => {
    // In a locale with a receipt of its own for the page, that receipt (envelope §2.3).
    const own = lang !== undefined ? localed.receipts.get(lang)?.get(page.key) : undefined
    const receipt = own ? servedReceiptOf(own, page.key) : servedReceiptOf(page)
    const image = firstImageOf(receipt)
    // The modules of the page as drawn: the layout's blocks too.
    const drawn = inLayout(page.key, receipt, layoutPage?.receipt).receipt
    return {
      receipt: `pwpack/surfaces/${own ? own.key : page.key}.receipt.json`,
      modules: [...new Set(blockTypesOf(drawn).map((t) => moduleOf.get(t)).filter((m): m is string => m !== undefined))].sort(),
      ...(image ? { image: servedHref(image.src), ...(image.priority ? { imagePriority: true } : {}) } : {}),
    }
  }
  // Every route's and the not-found page's, for the shell to ask for the
  // OPENED page's only (pwapp-format §2.1): never the entry page's on another.
  const hinted: Record<string, PageHints> = {}
  if (!gated) for (const page of [...routes, ...(notFoundPage ? [notFoundPage] : [])]) hinted[page.key] = hintsOf(page, locales?.defaultLocale)
  const router = options.router ?? 'hash'
  const byPath = router !== 'hash'
  const base = options.base ?? '/'
  // A page's address, as the runner's router writes it — into every link the
  // first frame draws, and the document each page is served from.
  // A page's address in a locale, as the runner's router writes it (envelope §3).
  const hrefIn = (lang: string, key: string): string => localeHref(localed.addresses, lang, key, byPath, base)
  const toHref = locales ? (key: string): string => hrefIn(locales.defaultLocale, key) : byPath ? pathHref(base, entry) : hashHref
  // The locales a document is drawn in: each under path routing; the
  // default's alone under hash routing, where the one document holds every
  // locale's routes and the runner draws the others.
  const drawnLocales = locales ? (byPath ? orderedLocales(locales) : [locales.defaultLocale]) : []
  // The inline scripts read the address as the runner will: by path when it routes by path.
  const routed = router === 'hash' ? {} : { router }
  const pageHints = {
    ...routed,
    entry,
    routes: routes.map((p) => p.key),
    ...(notFoundPage ? { notFound: notFoundPage.key } : {}),
    ...(locales ? { addresses: addressKeysOf(localed.addresses, locales.defaultLocale) } : {}),
    pages: hinted,
  }
  /** Each other locale drawn: its hints, frames and first-paint data (envelope §2.3). */
  const editions = new Map<string, { hinted: Record<string, PageHints>; painted: readonly PaintedPage[]; firstPaintJson?: Record<string, unknown> }>()
  for (const lang of drawnLocales) {
    if (lang === locales?.defaultLocale) continue
    const own: Record<string, PageHints> = {}
    if (!gated) for (const page of [...routes, ...(notFoundPage ? [notFoundPage] : [])]) own[page.key] = hintsOf(page, lang)
    editions.set(lang, { hinted: own, painted: [] })
  }
  const bootJs = bootScript({ assets: { ...assets0, boot: '' }, router })
  const assets: ShellAssets = { ...assets0, boot: hashedName('assets/boot.js', bootJs) }
  let painted: readonly PaintedPage[] = []
  // The rules every painted page writes the same, linked from every document (static-paint.ts shareFrameStyles).
  let frameAsset: string | undefined
  let firstPaintJson: Record<string, unknown> | undefined
  const documentsIn = (href: (key: string) => string): PageDocument[] =>
    pageDocuments({
      byPath,
      entry,
      routes: routes.map((p) => p.key),
      ...(notFoundPage ? { notFound: notFoundPage.key } : {}),
      base,
      toHref: href,
    })
  // An app with locales: one document per page per locale, `<prefix>404.html` for each other locale.
  const documents: PageDocument[] = locales
    ? drawnLocales.flatMap((lang) =>
        documentsIn((key) => hrefIn(lang, key)).map((d) => ({
          ...d,
          locale: lang,
          ...(d.notFound && lang !== locales.defaultLocale ? { file: `${localePrefix(lang)}404.html` } : {}),
        }))
      )
    : documentsIn(toHref)
  // One document per page under path routing, the one shell under hash
  // routing: each with its page's head and its page's first frame.
  const shell = (doc: (typeof documents)[number], csp?: string): Uint8Array => {
    const edition = doc.locale !== undefined ? editions.get(doc.locale) : undefined
    const docPainted = edition ? edition.painted : painted
    const docHints = edition ? { ...pageHints, addresses: addressKeysOf(localed.addresses, doc.locale as string), pages: edition.hinted } : pageHints
    const docFirstPaint = edition ? edition.firstPaintJson : firstPaintJson
    const own = doc.key === undefined ? undefined : docPainted.find((p) => p.key === doc.key)
    const page = doc.key === undefined ? undefined : pages.find((p) => p.key === doc.key)
    const head = documentHead({
      doc,
      receipt: page ? (servedIn(doc.locale).get(page.key) ?? page.receipt) : undefined,
      appTitle: title,
      ...(titleTemplate !== undefined ? { titleTemplate } : {}),
      // The document's words, for a title written with t() (envelope §2.3).
      ...(locales && doc.locale !== undefined
        ? { words: catalogueFor(localed.catalogues, locales, doc.locale), locale: doc.locale }
        : messages !== undefined
          ? { words: messages, ...(locale !== undefined ? { locale } : {}) }
          : {}),
      ...(appDescription !== undefined ? { appDescription } : {}),
      ...(origin !== undefined ? { origin } : {}),
      ...(image !== undefined ? { image } : {}),
      gated,
      base,
    })
    return enc.encode(
      buildShellHtml({
        title: head.title,
        ...(head.description !== undefined ? { description: head.description } : {}),
        ...(head.canonical !== undefined ? { canonical: head.canonical } : {}),
        ...(locales && byPath && origin !== undefined && !doc.notFound && doc.key !== undefined && !gated
          ? { alternates: hreflangsOf(locales, (lang) => canonicalOf(origin, hrefIn(lang, doc.key as string))) }
          : {}),
        ...(head.image !== undefined ? { image: head.image } : {}),
        ...(head.noindex ? { noindex: true } : {}),
        ...(doc.locale !== undefined ? { lang: doc.locale, localized: true } : locale !== undefined ? { lang: locale } : {}),
        ...(title ? { siteName: title } : {}),
        ...(locales && doc.locale !== undefined
          ? { ogLocale: { locale: doc.locale, alternates: locales.locales.filter((l) => l !== doc.locale) } }
          : locale !== undefined
            ? { ogLocale: { locale } }
            : {}),
        ...(fontAssets.preload !== undefined ? { fontPreload: fontAssets.preload } : {}),
        ...(options.shellExtra !== undefined ? { bodyExtra: options.shellExtra } : {}),
        ...(csp !== undefined ? { csp } : {}),
        ...(favicon !== undefined ? { favicon } : {}),
        ...(schemeScript !== undefined ? { colorSchemeScript: schemeScript } : {}),
        assets: frameAsset ? { ...assets, frame: frameAsset } : assets,
        preloadRenderer: !gated,
        bootFiles: BOOT_FILES.filter((f) => files.has(f)),
        pageHints: { ...docHints, ...(doc.key !== undefined ? { page: doc.key } : {}) },
        ...(docFirstPaint
          ? { firstPaint: { rootHtml: own ? staticRootHtml(own) : '', layoutCss: own?.layoutCss ?? '', data: docFirstPaint } }
          : {}),
        router,
        ...(options.base !== undefined ? { base: options.base } : {}),
      })
    )
  }
  files.set(assets.boot, enc.encode(bootJs))
  files.set(assets.runner, enc.encode(runtime.runnerJs))
  files.set(assets.embed, enc.encode(runtime.embedJs))
  files.set(assets.theme, themeCss)
  for (const [path, bytes] of fontAssets.files) files.set(path, bytes)
  for (const [name, source] of await shimsFor(runtime.embedJs)) files.set(`shims/${name}`, enc.encode(source))
  for (const [file, bytes] of [...modules].sort((a, b) => (a[0] < b[0] ? -1 : 1))) files.set(file, bytes)
  files.set('blocks/manifest.json', json(blockManifest))
  files.set('engines/manifest.json', json(engineManifest))

  // ── each page's words per locale (envelope §2.3): a page fetches only the
  // ids it, its layout and the runner read, its locale's over the default's;
  // a page that reads a word by an id it computes fetches the catalogue too.
  const pageWords = pageWordsOf(localed, locales, [...pages], (key, receipt) => inLayout(key, receipt, layoutPage?.receipt).receipt)
  files.set(
    'pwpack/project.json',
    json({
      ...buildProjectJson({
        id: identity.id,
        title,
        entry,
        pages: routes,
        notFound: notFoundPage,
        signIn: signInPage,
        auth: authDoc,
        ...(locale !== undefined ? { locale } : {}),
        ...(messages !== undefined ? { messages } : {}),
      }),
      ...(appDescription !== undefined ? { description: appDescription } : {}),
      ...(titleTemplate !== undefined ? { titleTemplate } : {}),
      ...(origin !== undefined ? { origin } : {}),
      ...(image !== undefined ? { image: /^https?:\/\//i.test(image) ? image : `pwpack/${image.replace(/^\.?\//, '')}` } : {}),
      // The scripts the runner loads once the visitor consents (envelope §2.2).
      ...(planScripts.length > 0 ? { scripts: planScripts } : {}),
      ...(publicFiles.length > 0 ? { publicFiles: publicFiles.map(([rel]) => rel) } : {}),
      ...(layoutPage ? { layoutReceiptFile: LAYOUT_RECEIPT_FILE } : {}),
      // The app's languages, its address table and its per-locale receipts (envelope §2.3).
      ...(locales
        ? {
            locales: locales.locales,
            defaultLocale: locales.defaultLocale,
            addresses: localed.addresses,
            ...(localed.pages.length > 0 ? { localeReceiptFiles: localed.receiptFiles } : {}),
            // Each page's words in each locale: what it, its layout and the runner read.
            pageMessages: pageWords.files,
            ...(pageWords.dynamic.length > 0 ? { pageMessagesDynamic: pageWords.dynamic } : {}),
          }
        : {}),
    })
  )
  for (const [lang, words] of Object.entries(localed.catalogues)) files.set(`pwpack/messages/${lang}.json`, json(words))
  for (const [path, words] of pageWords.bodies) files.set(`pwpack/${path}`, json(words))
  for (const page of localed.pages) {
    const base = page.key.slice(0, page.key.lastIndexOf('.'))
    const declared = withoutAuthoring(
      withPageAppearance(withSessionSources(withRecordFields(page.receipt, recordFields), entityDeclarations, authDeclaration), pageAppearance.get(base))
    )
    files.set(`pwpack/surfaces/${page.key}.receipt.json`, declared === page.receipt ? page.bytes : json(declared))
  }
  for (const page of pages) {
    const declared = withoutAuthoring(
      withPageAppearance(
        withSessionSources(withRecordFields(page.receipt, recordFields), entityDeclarations, authDeclaration),
        pageAppearance.get(page.key)
      )
    )
    files.set(`pwpack/surfaces/${page.key}.receipt.json`, declared === page.receipt ? page.bytes : json(declared))
  }
  if (layoutPage) {
    const declared = withoutAuthoring(withSessionSources(withRecordFields(layoutPage.receipt, recordFields), entityDeclarations, authDeclaration))
    files.set(`pwpack/${LAYOUT_RECEIPT_FILE}`, declared === layoutPage.receipt ? layoutPage.bytes : json(declared))
  }
  files.set('pwpack/navigation.json', json(isRecord(navigationDoc) ? navigationDoc : deriveNavigation(routes, entry)))
  if (appearance) files.set('pwpack/appearance.json', json(appearance))
  // Always written: the runner asks for it on every boot, and an app that
  // declares no connection should not cost the visitor a 404 in the console.
  files.set('pwpack/connections.json', json(connections ?? { connections: [] }))
  for (const [file, bytes] of media.files) files.set(`pwpack/${file}`, bytes)
  mergeEnvelopeEntries(files, options.envelopeEntries, diagnostics)
  // An identity without an `auth.json` has no door: say so, so the runner
  // does not ask for a file that is not there (session-protocol §2).
  if (!files.has('pwpack/auth.json')) {
    const project = JSON.parse(new TextDecoder().decode(files.get('pwpack/project.json'))) as Record<string, unknown>
    if (isRecord(project['identity'])) {
      files.set('pwpack/project.json', json({ ...project, identity: { ...project['identity'], door: false } }))
    }
  }
  // After the host's entries, so a receipt the host rewrote gets its media too.
  for (const page of pages) {
    const path = `pwpack/surfaces/${page.key}.receipt.json`
    const filled = fillMediaSlots(files.get(path) as Uint8Array, media.slots.get(page.key))
    if (filled) files.set(path, filled)
  }
  for (const page of localed.pages) {
    const path = `pwpack/surfaces/${page.key}.receipt.json`
    const filled = fillMediaSlots(files.get(path) as Uint8Array, media.slots.get(page.key.slice(0, page.key.lastIndexOf('.'))))
    if (filled) files.set(path, filled)
  }

  // ── the Content Security Policy ──────────────────────────────────
  const servedReceipts = new Map<string, unknown>()
  for (const page of pages) {
    const bytes = files.get(`pwpack/surfaces/${page.key}.receipt.json`)
    try {
      servedReceipts.set(page.key, bytes ? JSON.parse(new TextDecoder().decode(bytes)) : page.receipt)
    } catch {
      servedReceipts.set(page.key, page.receipt)
    }
  }
  // Each page as drawn: assembled into the layout as served (receipt §4).
  const servedLayoutBytes = files.get(`pwpack/${LAYOUT_RECEIPT_FILE}`)
  let servedLayout: unknown = layoutPage?.receipt
  try {
    if (layoutPage && servedLayoutBytes) servedLayout = JSON.parse(new TextDecoder().decode(servedLayoutBytes)) as unknown
  } catch {
    // The source's layout stands in.
  }
  const drawnReceipts = new Map<string, unknown>()
  for (const [key, receipt] of servedReceipts) drawnReceipts.set(key, inLayout(key, receipt, servedLayout, blockManifest).receipt)
  // A locale's pages: its own receipt for a page when it has one (envelope §2.3).
  const servedByLocale = new Map<string, Map<string, unknown>>()
  for (const [lang, own] of localed.receipts) {
    const map = new Map(servedReceipts)
    for (const [key, page] of own) {
      const bytes = files.get(`pwpack/surfaces/${page.key}.receipt.json`)
      let receipt: unknown = page.receipt
      try {
        if (bytes) receipt = JSON.parse(new TextDecoder().decode(bytes)) as unknown
      } catch {
        // the source's receipt stands in
      }
      map.set(key, receipt)
      drawnReceipts.set(page.key, inLayout(key, receipt, servedLayout, blockManifest).receipt)
    }
    servedByLocale.set(lang, map)
  }
  const servedIn = (lang: string | undefined): ReadonlyMap<string, unknown> => (lang !== undefined ? (servedByLocale.get(lang) ?? servedReceipts) : servedReceipts)
  const envelopeAuthBytes = files.get('pwpack/auth.json')

  // ── the static first paint (pwapp-format §2.5) ────────────────────
  // Every route's first frame and the not-found page's, rendered from the
  // files as served. Not for an app that requires sign-in: who is signed in
  // decides its first frame.
  if (!gated && runtime.staticJs) {
    const served = (path: string): unknown => {
      const bytes = files.get(path)
      if (!bytes) return undefined
      try {
        return JSON.parse(new TextDecoder().decode(bytes)) as unknown
      } catch {
        return undefined
      }
    }
    const project = served('pwpack/project.json')
    const paintable = [...routes, ...(notFoundPage ? [notFoundPage] : [])]
    /** The pages of one locale (the app's, in a single-language app), painted as the runner draws them there. */
    const paintIn = async (lang: string | undefined): Promise<{ pages: readonly PaintedPage[]; diagnostics: readonly AssembleDiagnostic[] }> => {
      if (!isRecord(project)) return { pages: [], diagnostics: [] }
      const own = lang !== undefined ? localed.receipts.get(lang) : undefined
      const drawnOf = (key: string): unknown => drawnReceipts.get(own?.get(key)?.key ?? key)
      const href = lang !== undefined ? (key: string): string => hrefIn(lang, key) : toHref
      return paintPages({
        staticJs: runtime.staticJs as string,
        blockManifest,
        files,
        // The project as a page in that locale reads it: its locale and its words.
        project: lang !== undefined && locales ? { ...project, locale: lang, messages: catalogueFor(localed.catalogues, locales, lang) } : project,
        navigation: served('pwpack/navigation.json'),
        appearance: served('pwpack/appearance.json'),
        auth: isRecord(project['identity']) ? served('pwpack/auth.json') : undefined,
        pages: paintable.map((p) => ({
          key: p.key,
          receipt: (drawnOf(p.key) ?? p.receipt) as Record<string, unknown>,
          ...(locales
            ? { extra: { locales: locales.locales, alternates: Object.fromEntries(locales.locales.map((l) => [l, hrefIn(l, p === notFoundPage ? entry : p.key)])) } }
            : {}),
        })),
        toHref: href,
      })
    }
    const langs: (string | undefined)[] = locales ? drawnLocales : [undefined]
    const results = []
    for (const lang of langs) results.push({ lang, result: await paintIn(lang) })
    for (const r of results) diagnostics.push(...r.result.diagnostics)
    // A <style> text two or more pages write, sent once — across every locale.
    const shared = shareFrameStyles(results.flatMap((r) => r.result.pages))
    if (shared.css !== '') {
      const bytes = enc.encode(shared.css)
      frameAsset = hashedName('assets/frame.css', bytes)
      files.set(frameAsset, bytes)
    }
    let at = 0
    for (const { lang, result } of results) {
      const href = lang !== undefined ? (key: string): string => hrefIn(lang, key) : toHref
      const mine = shared.pages.slice(at, at + result.pages.length)
      at += result.pages.length
      // Under path routing each page is a document of its own: a fragment-only
      // link names a place in THAT page, not in the one `<base href>` names.
      // Rewritten on the final frame, after the shared rules left it.
      const framed = byPath ? mine.map((p) => ({ ...p, html: onPageFragmentLinks(p.html, href(p.key)) })) : mine
      const other = lang !== undefined && lang !== locales?.defaultLocale ? editions.get(lang) : undefined
      const frameLang = other ? lang : undefined
      const hints = other ? other.hinted : hinted
      // Every painted page's frame is also a file of its own, for a document
      // that holds another page's (a hash address, a host's SPA fallback).
      for (const page of framed) files.set(staticPageFile(page.key, frameLang), enc.encode(staticPageFragment(page)))
      // Such a document asks for it with itself (shell.ts PageHints.frame).
      for (const page of framed) {
        const hint = hints[page.key]
        if (hint) hints[page.key] = { ...hint, frame: staticPageFile(page.key, frameLang), ...(page.addressKeys.length > 0 ? { frameKeys: page.addressKeys } : {}) }
      }
      const data =
        framed.length > 0
          ? firstPaintData({
              ...routed,
              entry,
              routes: routes.map((p) => p.key),
              ...(notFoundPage ? { notFound: notFoundPage.key } : {}),
              pages: framed,
              ...(locales && lang !== undefined ? { locale: { lang: frameLang ?? lang, addresses: addressKeysOf(localed.addresses, lang) } } : {}),
            })
          : undefined
      if (other) editions.set(lang as string, { ...other, painted: framed, ...(data ? { firstPaintJson: data } : {}) })
      else {
        painted = framed
        firstPaintJson = data
      }
    }
  }

  const csp = deriveCsp({
    importMapText: importMapText(),
    inlineScripts: [
      ...(Object.keys(hinted).length > 0 ? [locales ? PAGE_HINTS_SCRIPT_LOCALES : PAGE_HINTS_SCRIPT] : []),
      ...(firstPaintJson || [...editions.values()].some((e) => e.firstPaintJson) ? [locales ? FIRST_PAINT_SCRIPT_LOCALES : FIRST_PAINT_SCRIPT] : []),
      ...(schemeScript !== undefined ? [schemeScript] : []),
    ],
    receipts: drawnReceipts,
    connections,
    engines: engineManifest,
    envelopeAuth: envelopeAuthBytes ? JSON.parse(new TextDecoder().decode(envelopeAuthBytes)) : undefined,
    authDefinition: authDoc,
    media: media.records,
    blocks: placedBlocks,
    scripts: planScriptOrigins(planScripts),
    ...(favicon !== undefined ? { favicon } : {}),
  })
  // Written last: the shell preloads only boot files the folder has.
  for (const doc of documents) files.set(doc.file, shell(doc, csp.meta))
  // The plan's headers come after the engine's, and may not set one the
  // engine sets on a path they share (pwapp-format §2.6).
  const engineHeaders = headersFile(csp.header, csp.mediaHeader, documents.map((d) => d.file))
  const planHeaders = planHeadersOf(
    plan,
    diagnostics,
    parseHeadersFile(engineHeaders).map((r) => ({ path: r.pattern, headers: r.headers.map(([name]) => name.replace(/^!\s*/, '')) }))
  )
  files.set('_headers', enc.encode(headersFile(csp.header, csp.mediaHeader, documents.map((d) => d.file), planHeaders)))
  // THE SITEMAP: every page's own address on the app's public origin — not a
  // record page (it names no page without its record), and nothing of an app
  // that requires sign-in, which a crawler cannot read.
  const listedDocs = origin === undefined || gated
    ? []
    : documents
        .filter((d) => !d.notFound && d.key !== undefined && d.path !== undefined)
        .filter((d) => !isRecordPage(servedReceipts.get(d.key as string)))
        .map((d) => ({ key: d.key as string, url: canonicalOf(origin, d.path as string), locale: d.locale }))
        .filter((d): d is { key: string; url: string; locale: string | undefined } => d.url !== undefined)
  const listed = listedDocs.map((d) => d.url)
  const baseDir = base.endsWith('/') ? base : `${base}/`
  const sitemap = listed.length > 0 ? canonicalOf(origin, `${baseDir}sitemap.xml`) : undefined
  if (sitemap !== undefined) {
    // An app with locales (path routing): every page per locale, each with its alternates (pwapp-format §2.4).
    const entries = locales && byPath
      ? listedDocs.map((d) => ({ url: d.url, alternates: hreflangsOf(locales, (lang) => canonicalOf(origin, hrefIn(lang, d.key))) }))
      : undefined
    files.set('sitemap.xml', enc.encode(entries ? sitemapXmlLocales(entries) : sitemapXml(listed)))
  }
  files.set('robots.txt', enc.encode(robotsTxt(sitemap)))
  // THE PAGES FOR A LANGUAGE MODEL (llms.txt, llms-full.txt): the sitemap's
  // pages, in the app's navigation order, under path routing — where each
  // page has an address of its own to cite.
  if (byPath && origin !== undefined && listedDocs.length > 0) {
    const order = navigationOrder(JSON.parse(new TextDecoder().decode(files.get('pwpack/navigation.json'))) as unknown, entry, [...new Set(listedDocs.map((d) => d.key))])
    const llmsPages: LlmsPage[] = order.map((key) => {
      const doc = listedDocs.find((d) => d.key === key) as { key: string; url: string }
      const receipt = servedReceipts.get(key)
      const own = painted.find((p) => p.key === key)
      const description = literalText(wordedText(isRecord(receipt) ? receipt['description'] : undefined, messages, locale))
      return {
        title: literalText(wordedText(isRecord(receipt) ? receipt['title'] : undefined, messages, locale)) ?? (title || key),
        url: doc.url,
        ...(description !== undefined ? { description } : {}),
        ...(own ? { html: own.html } : {}),
      }
    })
    const appInfo = { name: title || identity.id, ...(appDescription !== undefined ? { description: appDescription } : {}) }
    // A link the frame draws, as an absolute address: against the app's base
    // on its origin; a fragment against the page it is on.
    const linkFor = (page: LlmsPage) => (href: string): string | undefined => {
      if (href.trim() === '' || href.includes('{{')) return undefined
      try {
        return new URL(href, href.startsWith('#') ? page.url : `${origin}${baseDir}`).href
      } catch {
        return undefined
      }
    }
    if (locales) {
      // One section per locale, the default first (pwapp-format §2.4.1).
      const sections = drawnLocales.map((lang) => {
        const own = lang === locales.defaultLocale ? painted : (editions.get(lang)?.painted ?? [])
        const servedHere = servedIn(lang)
        const pagesHere: LlmsPage[] = order.flatMap((key) => {
          const doc = listedDocs.find((d) => d.key === key && d.locale === lang)
          if (!doc) return []
          const receipt = servedHere.get(key)
          const frame = own.find((p) => p.key === key)
          const description = literalText(wordedText(isRecord(receipt) ? receipt['description'] : undefined, catalogueFor(localed.catalogues, locales, lang), lang))
          return [{
            title: literalText(wordedText(isRecord(receipt) ? receipt['title'] : undefined, catalogueFor(localed.catalogues, locales, lang), lang)) ?? (title || key),
            url: doc.url,
            ...(description !== undefined ? { description } : {}),
            ...(frame ? { html: frame.html } : {}),
          }]
        })
        return { lang, pages: pagesHere }
      })
      files.set('llms.txt', enc.encode(llmsTxtLocales(appInfo, sections)))
      files.set('llms-full.txt', enc.encode(llmsFullTxtLocales(appInfo, sections, linkFor)))
    } else {
      files.set('llms.txt', enc.encode(llmsTxt(appInfo, llmsPages)))
      files.set('llms-full.txt', enc.encode(llmsFullTxt(appInfo, llmsPages, linkFor)))
    }
  }

  const publishedAtoms = atoms
    .filter((a) => used.has(a))
    .map((a) => {
      // A provider facet's module is its vendor's, with that module's hash.
      const shipped = blockManifest.find((b) => b.integrity === (a.hash ? hexOf(a.hash) : '')) ??
        engineManifest.find((e) => e.atomId === a.id && e.moduleUrl)
      return {
        kind: a.kind,
        id: a.id,
        hash: a.sourceHash,
        ...(shipped?.moduleUrl && shipped.integrity && a.hash ? { module: shipped.moduleUrl, integrity: shipped.integrity } : {}),
      }
    })
  // Public files next, so a redirect cannot shadow one of them either.
  copyPublic(publicFiles, files, diagnostics)
  // The plan's redirects, in the static-host `_redirects` convention, under
  // the app's base: none from an address the app serves, which a host
  // answers first.
  const servedPath = (from: string): boolean => {
    const rel = from.replace(/^\/+/, '')
    return rel === '' || files.has(rel) || files.has(`${rel.replace(/\/+$/, '')}/index.html`) || documents.some((d) => d.path === from)
  }
  const planRedirects = planRedirectsOf(plan, diagnostics, servedPath)
  if (planRedirects.length > 0) files.set('_redirects', enc.encode(redirectsFile(planRedirects, base)))
  files.set(
    'publish.json',
    json({
      formatVersion: '1.0',
      app: { id: identity.id, version: identity.version },
      liveVersion: identity.version,
      publishedAt: options.publishedAt ?? new Date().toISOString(),
      packs: sources.packs.map((p) => ({ id: p.id, version: p.version, hash: p.pinnedHash ?? hashPack(p.folder) })),
      atoms: publishedAtoms,
      ...(media.records.length > 0 ? { media: media.records } : {}),
      csp: { policy: csp.header, ...(csp.unresolved.length > 0 ? { unresolved: csp.unresolved } : {}) },
      // For a host that does not read `_headers` / `_redirects` (pwapp-format §2.6).
      ...(planHeaders.length > 0 ? { headers: planHeaders.map((r) => ({ path: r.path, headers: Object.fromEntries(r.headers) })) } : {}),
      ...(planRedirects.length > 0 ? { redirects: planRedirects } : {}),
    })
  )

  const compiled = atoms.filter((a) => a.status === 'compiled' || a.status === 'precompiled')
  const declared = atoms.filter((a) => a.status === 'declared')
  return done({
    pages: routes.length,
    blocks: blockManifest.length,
    engines: engineManifest.length,
    atoms: atoms.length,
    compiled: compiled.length,
    fromCache: compiled.filter((a) => a.fromCache).length,
    failed: atoms.filter((a) => a.status === 'failed').length,
    ...(declared.length > 0 ? { skipped: declared.map((a) => ({ id: a.id, reason: skipReason(a) })) } : {}),
  })
}
