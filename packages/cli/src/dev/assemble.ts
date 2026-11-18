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
import { blockTypeNames, hashPack } from '@pwfabric/pack'
import { atomKindMeta, safeParseBlockOrigins, type BlockOrigins } from '@pwfabric/contracts'
import { compileSources, createCompileCache, type CompileCache, type CompiledAtom } from './compile.js'
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
  type BlockManifestEntry,
  type EngineManifestEntry,
  type Page,
} from './envelope.js'
import { collectMedia, fillMediaSlots } from './media.js'
import { deriveCsp, headersFile, robotsTxt } from './csp.js'
import {
  BOOT_FILES,
  bootScript,
  buildShellHtml,
  hashedName,
  importMapText,
  loadRuntimeAssets,
  shimsFor,
  type RuntimeAssets,
  type ShellAssets,
} from './shell.js'
import { isRecord, jsonOf, loadSources, PWF_DIR, type PackMemo, type SourcePack } from './sources.js'
import {
  appearanceConfigOf,
  buildThemeCss,
  resolveAppearance,
  themeAtomOf,
  themeWebfonts,
  webfontStylesheetHref,
  withWebfontFallbacks,
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
  const routeKeys = identity.app.surfaceOrder
  const offRoute = (key: string | undefined): string | undefined =>
    key !== undefined && !routeKeys.includes(key) ? key : undefined
  const notFoundKey = offRoute(identity.app.notFound)
  const signInKey = offRoute(identity.app.signIn)
  const keys = [...routeKeys, ...(notFoundKey ? [notFoundKey] : []), ...(signInKey && signInKey !== notFoundKey ? [signInKey] : [])]
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
  const used = new Set<CompiledAtom>()
  const placedBlocks: { atomId: string; origins?: BlockOrigins }[] = []
  const blockManifest: BlockManifestEntry[] = []
  const modules = new Map<string, Uint8Array>()
  const firstUse = new Map<string, Page>()
  for (const page of pages) for (const t of blockTypesOf(page.receipt)) if (!firstUse.has(t)) firstUse.set(t, page)
  for (const [type, page] of [...firstUse].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const candidates = byName.get(type) ?? []
    const atom = candidates[0]
    if (!atom) {
      diagnostics.push({
        severity: 'error',
        code: 'UNKNOWN_BLOCK_TYPE',
        message: `page "${page.key}" places a block of type "${type}", which neither the app nor its pinned packs define`,
        path: page.path,
      })
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
  const engineManifest: EngineManifestEntry[] = []
  for (const conn of connections?.connections ?? []) {
    const name = conn['name'] as string
    const wanted = typeof conn['connector'] === 'string' ? conn['connector'] : name
    const atom = atoms.find(
      (a) => (a.kind === 'connector' || a.kind === 'provider') && a.manifest?.['connection'] === wanted
    )
    if (!atom) continue
    used.add(atom)
    const kind = atom.kind as 'connector' | 'provider'
    if (atom.code && atom.hash) {
      const file = `engines/${moduleFileName(atom.id, hexOf(atom.hash))}`
      modules.set(file, enc.encode(atom.code))
      engineManifest.push({ connection: name, atomId: atom.id, kind, moduleUrl: file, integrity: hexOf(atom.hash) })
    } else if (atom.manifest?.['engine'] !== undefined) {
      engineManifest.push({ connection: name, atomId: atom.id, kind, engine: atom.manifest['engine'] })
    } else if (atom.status === 'failed') {
      diagnostics.push({
        severity: 'warning',
        code: 'ENGINE_NOT_COMPILED',
        message: `connection "${name}": engine ${atomLabel(atom)} did not compile, so its panels fall back to sample data`,
        path: 'app/definitions/connections.json',
      })
    }
  }

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
  const config = appearanceConfigOf(appearance)
  const title = titleOf(plan)
  const locale = isRecord(plan) && typeof plan['locale'] === 'string' ? plan['locale'] : undefined
  // The app's words (`plan.json` `messages`), carried as they are: the runner
  // reads every word it draws there first (envelope §2).
  const messages = messagesOf(plan, diagnostics)
  // The app in a sentence (`app/plan.json` `description`); the shell's
  // <meta name="description"> falls back to the entry page's own, which is
  // also what the runner shows on that page.
  const appDescription = textOf(plan, 'description')
  const entryPage = routes.find((p) => p.key === entry)
  const shellDescription = appDescription ?? textOf(entryPage?.receipt, 'description')
  // An app that requires sign-in shows a visitor the gate first; whether the
  // renderer is ever needed is up to the visitor, so it is not preloaded.
  const gated = isRecord(authDoc) && authDoc['required'] === true

  // ── the runtime files, content-hashed (cached as immutable: _headers) ──
  const webfontHref = webfontStylesheetHref(themeWebfonts(config))
  const themeCss = enc.encode(buildThemeCss(config))
  const assets0 = {
    embed: hashedName('assets/embed.js', runtime.embedJs),
    runner: hashedName('assets/runner.js', runtime.runnerJs),
    theme: hashedName('assets/theme.css', themeCss),
  }
  const bootJs = bootScript({ assets: { ...assets0, boot: '' }, webfontHref })
  const assets: ShellAssets = { ...assets0, boot: hashedName('assets/boot.js', bootJs) }
  const shell = (csp?: string): Uint8Array =>
    enc.encode(
      buildShellHtml({
        title,
        ...(shellDescription !== undefined ? { description: shellDescription } : {}),
        ...(locale !== undefined ? { lang: locale } : {}),
        ...(config ? { appearance: config } : {}),
        ...(options.shellExtra !== undefined ? { bodyExtra: options.shellExtra } : {}),
        ...(csp !== undefined ? { csp } : {}),
        assets,
        preloadRenderer: !gated,
        bootFiles: BOOT_FILES.filter((f) => files.has(f)),
      })
    )
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
    })
  )
  for (const page of pages) files.set(`pwpack/surfaces/${page.key}.receipt.json`, page.bytes)
  files.set('pwpack/navigation.json', json(isRecord(navigationDoc) ? navigationDoc : deriveNavigation(routes, entry)))
  if (appearance) files.set('pwpack/appearance.json', json(appearance))
  // Always written: the runner asks for it on every boot, and an app that
  // declares no connection should not cost the visitor a 404 in the console.
  files.set('pwpack/connections.json', json(connections ?? { connections: [] }))
  const media = collectMedia(app.folder, diagnostics)
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
  const csp = deriveCsp({
    importMapText: importMapText(),
    receipts: servedReceipts,
    connections,
    engines: engineManifest,
    envelopeAuth: envelopeAuthBytes ? JSON.parse(new TextDecoder().decode(envelopeAuthBytes)) : undefined,
    authDefinition: authDoc,
    media: media.records,
    webfontHref,
    blocks: placedBlocks,
  })
  // Written last: the shell preloads only boot files the folder has.
  files.set('index.html', shell(csp.meta))
  files.set('_headers', enc.encode(headersFile(csp.header)))
  files.set('robots.txt', enc.encode(robotsTxt()))

  const publishedAtoms = atoms
    .filter((a) => used.has(a))
    .map((a) => {
      const module = blockManifest.find((b) => b.integrity === (a.hash ? hexOf(a.hash) : ''))?.moduleUrl ??
        engineManifest.find((e) => e.atomId === a.id && e.moduleUrl)?.moduleUrl
      return {
        kind: a.kind,
        id: a.id,
        hash: a.sourceHash,
        ...(module && a.hash ? { module, integrity: hexOf(a.hash) } : {}),
      }
    })
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
    })
  )

  const compiled = atoms.filter((a) => a.status === 'compiled' || a.status === 'precompiled')
  return done({
    pages: routes.length,
    blocks: blockManifest.length,
    engines: engineManifest.length,
    atoms: atoms.length,
    compiled: compiled.length,
    fromCache: compiled.filter((a) => a.fromCache).length,
    failed: atoms.filter((a) => a.status === 'failed').length,
  })
}
