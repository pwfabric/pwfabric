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
import { blockPropDescriptors, blockTypeFirstUses, blockTypeNames, checkBlockIds, checkReceiptBlockProps, hashPack, publicReservedReason, publicScriptReason, unknownBlockTypeIssue } from '@pwfabric/pack'
import type { BlockOrigins } from '@pwfabric/contracts'
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
import { declaredRecordFields, withRecordFields } from '../host/record-fields.js'
import { withSessionSources } from '../host/session-sources.js'
import { authDeclarationOf, entityDeclarationsOf } from '../host/definitions.js'
import { deriveCsp, headersFile } from './csp.js'
import { documentHead, isRecordPage, pageDocuments, publicOriginOf, robotsTxt, SERVED_FOLDERS, sitemapXml } from './documents.js'
import { llmsFullTxt, llmsTxt, type LlmsPage } from './llms.js'
import { planHeadersOf, planRedirectsOf, planScriptOrigins, planScriptsOf, redirectsFile } from './plan-site.js'
import { parseHeadersFile } from '../commands/lib/static-server.js'
import { firstPaintData, onPageFragmentLinks, paintPages, shareFrameStyles, staticPageFile, staticPageFragment, staticRootHtml, type PaintedPage } from './static-paint.js'
import { canonicalOf, hashHref, pathHref } from '@pwfabric/runner'
import {
  BOOT_FILES,
  FIRST_PAINT_SCRIPT,
  PAGE_HINTS_SCRIPT,
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
  webfontsOf,
  webfontStylesheetHref,
  withWebfontFallbacks,
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
 * The app's resolved appearance with each webfont's metric-matched stand-in
 * named in its stacks (theme.ts `withWebfontFallbacks`), in whichever of the
 * shapes it came.
 */
function withFallbackStacks(doc: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!doc) return doc
  return isRecord(doc['config']) ? { ...doc, config: withWebfontFallbacks(doc['config']) } : withWebfontFallbacks(doc)
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

/**
 * The app's icon (`appearance` `brand.favicon`) as the documents link it: an
 * absolute http(s) address as written; a media file of the app
 * (`media/<file>`) as served, `pwpack/media/<file>`; a public file
 * (`public/favicon.ico`, or `favicon.ico`) at the app's root. A file the app does not have, or any other
 * form, is an error (FAVICON_INVALID) and the documents keep the empty icon.
 */
function faviconOf(config: Record<string, unknown> | undefined, files: ReadonlyMap<string, Uint8Array>, diagnostics: AssembleDiagnostic[]): string | undefined {
  const brand = isRecord(config) ? config['brand'] : undefined
  const raw = isRecord(brand) ? brand['favicon'] : undefined
  if (raw === undefined) return undefined
  const value = typeof raw === 'string' ? raw.trim() : ''
  // An address the head carries: visible ASCII, no whitespace or control character.
  if (/^https?:\/\/[\x21-\x7e]+$/i.test(value)) return value
  const file = value.replace(/^\.?\//, '')
  if (/^media\/(?!.*(?:^|\/)\.\.?(?:\/|$))[^\s?#]+$/.test(file) && files.has(file)) return `pwpack/${file}`
  // A public file (`public/favicon.ico`, or as served: `favicon.ico`) is served at the app's root.
  const served = file.replace(/^public\//, '')
  if (/^[^\s?#]+$/.test(served) && !served.split('/').some((seg) => seg === '..' || seg === '.') && files.has(`public/${served}`)) return served
  diagnostics.push({
    severity: 'error',
    code: 'FAVICON_INVALID',
    message: `brand.favicon is "${value}": it is an http(s) address or a file of the app (media/<file>, or a file of public/), and the app has no such file`,
    path: 'app/definitions/appearance.json',
  })
  return undefined
}

/** The folder whose files a build copies, as they are, to the root of the served folder. */
export const PUBLIC_DIR = 'public/'

/**
 * The app's `public/` files as served (`public/favicon.ico` → `favicon.ico`),
 * each with its bytes: those `pwf validate` does not already refuse (a path
 * the build writes, a file that is script — pwpack-format §1.4).
 */
function publicFilesOf(appFiles: ReadonlyMap<string, Uint8Array>, pageKeys: readonly string[]): [string, Uint8Array][] {
  const out: [string, Uint8Array][] = []
  for (const path of [...appFiles.keys()].filter((p) => p.startsWith(PUBLIC_DIR)).sort()) {
    const rel = path.slice(PUBLIC_DIR.length)
    const bytes = appFiles.get(path) as Uint8Array
    if (rel === '' || publicReservedReason(rel, pageKeys) || publicScriptReason(rel, bytes)) continue
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
  const propCatalog = new Map<string, { atomId: string; props: NonNullable<ReturnType<typeof blockPropDescriptors>> }>()
  for (const [name, list] of byName) {
    const props = list[0] ? blockPropDescriptors(list[0].manifest) : undefined
    if (list[0] && props) propCatalog.set(name, { atomId: list[0].id, props })
  }
  for (const page of pages) {
    for (const issue of checkReceiptBlockProps(page.receipt, propCatalog, page.path)) {
      diagnostics.push({ severity: 'warning', code: issue.code, message: issue.message, path: page.path })
    }
    // A block id is unique within its page (receipt §2), as `pwf validate` says too.
    for (const issue of checkBlockIds(page)) diagnostics.push({ severity: 'error', code: issue.code, message: issue.message, path: page.path })
  }

  const used = new Set<CompiledAtom>()
  const placedBlocks: { atomId: string; origins?: BlockOrigins }[] = []
  const blockManifest: BlockManifestEntry[] = []
  const modules = new Map<string, Uint8Array>()
  for (const [type, page] of blockTypeFirstUses(pages)) {
    const candidates = byName.get(type) ?? []
    const atom = candidates[0]
    if (!atom) {
      // The same finding, worded the same, as `pwf validate` (@pwfabric/pack checkBlockTypes).
      const issue = unknownBlockTypeIssue(type, page)
      diagnostics.push({ severity: 'error', code: issue.code, message: issue.message, path: page.path })
      continue
    }
    if (!used.has(atom)) placedBlocks.push({ atomId: atom.id, ...declaredOrigins(atom, diagnostics) })
    used.add(atom)
    if (candidates.length > 1) {
      diagnostics.push({
        severity: 'info',
        code: 'BLOCK_TYPE_SHADOWED',
        message: `block type "${type}" resolves to ${atomLabel(atom)}; also defined by ${candidates.slice(1).map(atomLabel).join(', ')}`,
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
  const publicFiles = publicFilesOf(app.folder.files, keys)
  // The app's icon: every document links it.
  const favicon = faviconOf(config, app.folder.files, diagnostics)
  // An app that requires sign-in shows a visitor the gate first; whether the
  // renderer is ever needed is up to the visitor, so it is not preloaded.
  const gated = isRecord(authDoc) && authDoc['required'] === true

  // ── the runtime files, content-hashed (cached as immutable: _headers) ──
  // One stylesheet for the webfonts of the app's theme and of every page's own.
  const webfontHref = webfontStylesheetHref(webfontsOf([config, ...pageThemes.map((p) => p.config)]))
  const themeCss = enc.encode(buildThemeCss(config, pageThemes))
  const assets0 = {
    embed: hashedName('assets/embed.js', runtime.embedJs),
    runner: hashedName('assets/runner.js', runtime.runnerJs),
    theme: hashedName('assets/theme.css', themeCss),
  }
  // ── what each page needs first (shell and boot hints) ──
  const moduleOf = new Map(blockManifest.map((b) => [b.blockType, b.moduleUrl]))
  // The receipt as it will be served: its media slots filled.
  const media = collectMedia(app.folder, diagnostics)
  const servedReceiptOf = (page: Page): unknown => {
    const filled = fillMediaSlots(page.bytes, media.slots.get(page.key))
    if (!filled) return page.receipt
    try {
      return JSON.parse(new TextDecoder().decode(filled)) as unknown
    } catch {
      return page.receipt
    }
  }
  const hintsOf = (page: Page): PageHints => {
    const receipt = servedReceiptOf(page)
    const image = firstImageOf(receipt)
    return {
      receipt: `pwpack/surfaces/${page.key}.receipt.json`,
      modules: [...new Set(blockTypesOf(receipt).map((t) => moduleOf.get(t)).filter((m): m is string => m !== undefined))].sort(),
      ...(image ? { image: servedHref(image.src), ...(image.priority ? { imagePriority: true } : {}) } : {}),
    }
  }
  // Every route's and the not-found page's, for the shell to ask for the
  // OPENED page's only (pwapp-format §2.1): never the entry page's on another.
  const hinted: Record<string, PageHints> = {}
  if (!gated) for (const page of [...routes, ...(notFoundPage ? [notFoundPage] : [])]) hinted[page.key] = hintsOf(page)
  const router = options.router ?? 'hash'
  const byPath = router !== 'hash'
  const base = options.base ?? '/'
  // A page's address, as the runner's router writes it — into every link the
  // first frame draws, and the document each page is served from.
  const toHref = byPath ? pathHref(base, entry) : hashHref
  // The inline scripts read the address as the runner will: by path when it routes by path.
  const routed = router === 'hash' ? {} : { router }
  const pageHints = {
    ...routed,
    entry,
    routes: routes.map((p) => p.key),
    ...(notFoundPage ? { notFound: notFoundPage.key } : {}),
    pages: hinted,
  }
  const bootJs = bootScript({ assets: { ...assets0, boot: '' }, webfontHref, router })
  const assets: ShellAssets = { ...assets0, boot: hashedName('assets/boot.js', bootJs) }
  let painted: readonly PaintedPage[] = []
  // The rules every painted page writes the same, linked from every document (static-paint.ts shareFrameStyles).
  let frameAsset: string | undefined
  let firstPaintJson: Record<string, unknown> | undefined
  const documents = pageDocuments({
    byPath,
    entry,
    routes: routes.map((p) => p.key),
    ...(notFoundPage ? { notFound: notFoundPage.key } : {}),
    base,
    toHref,
  })
  // One document per page under path routing, the one shell under hash
  // routing: each with its page's head and its page's first frame.
  const shell = (doc: (typeof documents)[number], csp?: string): Uint8Array => {
    const own = doc.key === undefined ? undefined : painted.find((p) => p.key === doc.key)
    const page = doc.key === undefined ? undefined : pages.find((p) => p.key === doc.key)
    const head = documentHead({
      doc,
      receipt: page ? (servedReceipts.get(page.key) ?? page.receipt) : undefined,
      appTitle: title,
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
        ...(head.image !== undefined ? { image: head.image } : {}),
        ...(head.noindex ? { noindex: true } : {}),
        ...(locale !== undefined ? { lang: locale } : {}),
        webfontHref,
        ...(options.shellExtra !== undefined ? { bodyExtra: options.shellExtra } : {}),
        ...(csp !== undefined ? { csp } : {}),
        ...(favicon !== undefined ? { favicon } : {}),
        assets: frameAsset ? { ...assets, frame: frameAsset } : assets,
        preloadRenderer: !gated,
        bootFiles: BOOT_FILES.filter((f) => files.has(f)),
        pageHints: { ...pageHints, ...(doc.key !== undefined ? { page: doc.key } : {}) },
        ...(firstPaintJson
          ? { firstPaint: { rootHtml: own ? staticRootHtml(own) : '', layoutCss: own?.layoutCss ?? '', data: firstPaintJson } }
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
  for (const [name, source] of await shimsFor(runtime.embedJs)) files.set(`shims/${name}`, enc.encode(source))
  for (const [file, bytes] of [...modules].sort((a, b) => (a[0] < b[0] ? -1 : 1))) files.set(file, bytes)
  files.set('blocks/manifest.json', json(blockManifest))
  files.set('engines/manifest.json', json(engineManifest))

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
      ...(origin !== undefined ? { origin } : {}),
      ...(image !== undefined ? { image: /^https?:\/\//i.test(image) ? image : `pwpack/${image.replace(/^\.?\//, '')}` } : {}),
      // The scripts the runner loads once the visitor consents (envelope §2.2).
      ...(planScripts.length > 0 ? { scripts: planScripts } : {}),
      ...(publicFiles.length > 0 ? { publicFiles: publicFiles.map(([rel]) => rel) } : {}),
    })
  )
  for (const page of pages) {
    const declared = withoutAuthoring(
      withPageAppearance(
        withSessionSources(withRecordFields(page.receipt, recordFields), entityDeclarations, authDeclaration),
        pageAppearance.get(page.key)
      )
    )
    files.set(`pwpack/surfaces/${page.key}.receipt.json`, declared === page.receipt ? page.bytes : json(declared))
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
    const result = isRecord(project)
      ? await paintPages({
          staticJs: runtime.staticJs,
          blockManifest,
          files,
          project,
          navigation: served('pwpack/navigation.json'),
          appearance: served('pwpack/appearance.json'),
          auth: isRecord(project['identity']) ? served('pwpack/auth.json') : undefined,
          pages: paintable.map((p) => ({ key: p.key, receipt: (servedReceipts.get(p.key) ?? p.receipt) as Record<string, unknown> })),
          toHref,
        })
      : { pages: [] as PaintedPage[], diagnostics: [] }
    diagnostics.push(...result.diagnostics)
    // A <style> text two or more pages write, sent once.
    const shared = shareFrameStyles(result.pages)
    // Under path routing each page is a document of its own: a fragment-only
    // link names a place in THAT page, not in the one `<base href>` names.
    // Rewritten on the final frame, after the shared rules left it.
    painted = byPath ? shared.pages.map((p) => ({ ...p, html: onPageFragmentLinks(p.html, toHref(p.key)) })) : shared.pages
    if (shared.css !== '') {
      const bytes = enc.encode(shared.css)
      frameAsset = hashedName('assets/frame.css', bytes)
      files.set(frameAsset, bytes)
    }
    // Every painted page's frame is also a file of its own, for a document
    // that holds another page's (a hash address, a host's SPA fallback).
    for (const page of painted) files.set(staticPageFile(page.key), enc.encode(staticPageFragment(page)))
    // Such a document asks for it with itself (shell.ts PageHints.frame).
    for (const page of painted) {
      const hint = hinted[page.key]
      if (hint) hinted[page.key] = { ...hint, frame: staticPageFile(page.key), ...(page.addressKeys.length > 0 ? { frameKeys: page.addressKeys } : {}) }
    }
    if (painted.length > 0) {
      firstPaintJson = firstPaintData({
        ...routed,
        entry,
        routes: routes.map((p) => p.key),
        ...(notFoundPage ? { notFound: notFoundPage.key } : {}),
        pages: painted,
      })
    }
  }

  const csp = deriveCsp({
    importMapText: importMapText(),
    inlineScripts: [...(Object.keys(hinted).length > 0 ? [PAGE_HINTS_SCRIPT] : []), ...(firstPaintJson ? [FIRST_PAINT_SCRIPT] : [])],
    receipts: servedReceipts,
    connections,
    engines: engineManifest,
    envelopeAuth: envelopeAuthBytes ? JSON.parse(new TextDecoder().decode(envelopeAuthBytes)) : undefined,
    authDefinition: authDoc,
    media: media.records,
    webfontHref,
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
        .map((d) => ({ key: d.key as string, url: canonicalOf(origin, d.path as string) }))
        .filter((d): d is { key: string; url: string } => d.url !== undefined)
  const listed = listedDocs.map((d) => d.url)
  const baseDir = base.endsWith('/') ? base : `${base}/`
  const sitemap = listed.length > 0 ? canonicalOf(origin, `${baseDir}sitemap.xml`) : undefined
  if (sitemap !== undefined) files.set('sitemap.xml', enc.encode(sitemapXml(listed)))
  files.set('robots.txt', enc.encode(robotsTxt(sitemap)))
  // THE PAGES FOR A LANGUAGE MODEL (llms.txt, llms-full.txt): the sitemap's
  // pages, in the app's navigation order, under path routing — where each
  // page has an address of its own to cite.
  if (byPath && origin !== undefined && listedDocs.length > 0) {
    const order = navigationOrder(JSON.parse(new TextDecoder().decode(files.get('pwpack/navigation.json'))) as unknown, entry, listedDocs.map((d) => d.key))
    const llmsPages: LlmsPage[] = order.map((key) => {
      const doc = listedDocs.find((d) => d.key === key) as { key: string; url: string }
      const receipt = servedReceipts.get(key)
      const own = painted.find((p) => p.key === key)
      const description = literalText(isRecord(receipt) ? receipt['description'] : undefined)
      return {
        title: literalText(isRecord(receipt) ? receipt['title'] : undefined) ?? (title || key),
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
    files.set('llms.txt', enc.encode(llmsTxt(appInfo, llmsPages)))
    files.set('llms-full.txt', enc.encode(llmsFullTxt(appInfo, llmsPages, linkFor)))
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
