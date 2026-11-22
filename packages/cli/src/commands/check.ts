/**
 * `pwf check [out] [--links] [--weight] [--hydration]` — checks a built
 * pwapp as a visitor would meet it.
 *
 * links: every internal `href`, `src` and `srcset` of every page document
 * names something the build serves — a file, a page's document, a hash
 * route or per-locale address the app has, or a `_redirects` rule that lands
 * on one. weight: each document with the files it references (scripts,
 * styles, preloads, images), raw and gzipped, against a budget.
 * hydration: the first paint opened in a browser (./lib/hydration.ts), with
 * Playwright when it is installed. Without a flag: links and weight.
 */
import { gzipSync } from 'node:zlib'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { boolFlag, guard, stringFlag, UsageError } from './lib/flags.js'
import { resolveFrom } from './lib/project.js'
import { documentAddress, pageDocuments, readBuiltOutput, resolveServed, type BuiltOutput } from './lib/built-output.js'
import { checkPage, loadPlaywright, PLAYWRIGHT_MISSING, recordPageInfo, type PlaywrightLoader } from './lib/hydration.js'
import { startStaticServer } from './lib/static-server.js'
import { appFolderOf, isAppFolder, openRunSource, readOnlyHostFor } from './run.js'
import { HOST_PREFIX } from '../dev/server.js'

/** The default weight budget of one page: its document and what it references, gzipped. */
export const DEFAULT_BUDGET_KB = 500

export interface BrokenLink {
  readonly document: string
  readonly link: string
  readonly why: string
}

/** Every URL a document names: `href`, `src`, `poster`, `action` and each `srcset` candidate. */
export function documentLinks(html: string): string[] {
  const out: string[] = []
  const body = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (m) => (/^<script\b[^>]*\bsrc=/i.test(m) ? m.replace(/>[\s\S]*$/, '>') : ''))
  for (const m of body.matchAll(/\s(href|src|poster|action|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const value = (m[2] ?? m[3] ?? '').replace(/&amp;/g, '&')
    if ((m[1] as string).toLowerCase() === 'srcset') {
      for (const part of value.split(',')) {
        const url = part.trim().split(/\s+/)[0]
        if (url) out.push(url)
      }
    } else out.push(value)
  }
  return out
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i

/** The links of every page document that name nothing the build serves. */
export function brokenLinks(out: BuiltOutput, origin?: string): { checked: number; broken: BrokenLink[] } {
  const broken: BrokenLink[] = []
  let checked = 0
  const routes = new Set(out.addresses.map((a) => a.replace(/\/+$/, '')))
  // The entry's key opens the entry in every locale (`#/menu`, `#/de/menu`).
  if (out.entry) for (const a of out.entry.addresses) routes.add(`${a.replace(/\/*$/, '/')}${out.entry.key}`.replace(/^\/+/, ''))
  for (const doc of pageDocuments(out)) {
    const html = new TextDecoder().decode(out.files.get(doc))
    for (const raw of documentLinks(html)) {
      let link = raw.trim()
      if (link === '' || link.startsWith('{{')) continue
      if (origin && link.startsWith(origin)) link = link.slice(origin.length) || '/'
      if (EXTERNAL.test(link)) continue
      const hash = link.indexOf('#')
      const fragment = hash >= 0 ? link.slice(hash + 1) : ''
      const pathPart = (hash >= 0 ? link.slice(0, hash) : link).split('?')[0] as string
      checked++
      // A hash route (`#/pricing`, `#/de/preise/`) names a page of the app's.
      if (fragment.startsWith('/') && (pathPart === '' || pathPart === out.base || pathPart === './')) {
        const route = fragment.slice(1).split('?')[0]?.split('#')[0]?.replace(/\/+$/, '') ?? ''
        if (route !== '' && !routes.has(route)) broken.push({ document: doc, link: raw, why: `#/${route} is no page of the app` })
        continue
      }
      if (pathPart === '') continue // an in-page anchor
      // Relative links resolve against <base href>, as the browser does.
      const url = new URL(pathPart, `http://pwf.check${out.base}`)
      let path: string
      try {
        path = decodeURIComponent(url.pathname)
      } catch {
        broken.push({ document: doc, link: raw, why: 'is not a valid address' })
        continue
      }
      if (!path.startsWith(out.base)) {
        broken.push({ document: doc, link: raw, why: `is outside the app's base ${out.base}` })
        continue
      }
      const rel = path.slice(out.base.length)
      const served = resolveServed(out, rel)
      if (served.file) continue
      if (served.redirectedTo && /^https?:\/\//i.test(served.redirectedTo)) continue
      broken.push({ document: doc, link: raw, why: served.redirectedTo ? `redirects to ${served.redirectedTo}, which the build does not serve` : 'the build serves nothing there' })
    }
  }
  return { checked, broken }
}

export interface DocumentWeight {
  readonly document: string
  readonly address: string
  readonly raw: number
  readonly gzip: number
  /** The files it references that the build serves, counted once each. */
  readonly files: number
  readonly overBudget: boolean
  /** Video and audio the browser loads only when it plays (not counted): each file, raw. */
  readonly deferred: readonly { readonly file: string; readonly raw: number }[]
}

/** A `<video>` or `<audio>` element: its attributes and what it holds. */
const MEDIA_ELEMENT = /<(video|audio)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi

/**
 * The media URLs of `<video>` and `<audio>` elements the browser does not
 * load up front: no `autoplay`, and `preload` `none`, `metadata` or absent
 * (browsers fetch metadata at most, a few KB). Their `poster` is not among
 * them: that image is drawn at once.
 */
export function deferredMediaLinks(html: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(MEDIA_ELEMENT)) {
    const attrs = m[2] as string
    if (/\sautoplay(?:[\s=>]|$)/i.test(` ${attrs}`)) continue
    const preload = /\spreload\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/i.exec(` ${attrs}`)
    if (preload) {
      const value = (preload[1] ?? preload[2] ?? preload[3] ?? '').trim().toLowerCase()
      if (value === '' || value === 'auto') continue
    }
    for (const s of [`<${m[1]}${attrs}>`, ...((m[3] as string).match(/<source\b[^>]*>/gi) ?? [])]) {
      const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(s)
      if (src) out.push((src[1] ?? src[2] ?? '').replace(/&amp;/g, '&'))
    }
  }
  return out
}

/** Each page document with the files it names, raw and gzipped; video and audio it does not load up front are listed apart. */
export function documentWeights(out: BuiltOutput, budgetKb: number): DocumentWeight[] {
  const gz = new Map<string, number>()
  const gzipped = (rel: string): number => {
    let n = gz.get(rel)
    if (n === undefined) {
      n = gzipSync(out.files.get(rel) as Uint8Array, { level: 9 }).length
      gz.set(rel, n)
    }
    return n
  }
  /** The served file a link names, when it is a part of the page (not another page). */
  const partOf = (link: string): string | undefined => {
    if (EXTERNAL.test(link) || link.startsWith('#')) return undefined
    try {
      const path = decodeURIComponent(new URL(link.split('#')[0] as string, `http://pwf.check${out.base}`).pathname)
      if (!path.startsWith(out.base)) return undefined
      const rel = path.slice(out.base.length)
      if (rel === '' || rel.endsWith('/') || !out.files.has(rel)) return undefined // another page, not a part of this one
      return rel.endsWith('.html') ? undefined : rel
    } catch {
      return undefined // not an address
    }
  }
  return pageDocuments(out).map((doc) => {
    const html = new TextDecoder().decode(out.files.get(doc))
    // What the page loads up front: its links, each video or audio it does not load up front reduced to its poster.
    const shown = html.replace(MEDIA_ELEMENT, (m) => (deferredMediaLinks(m).length === 0 ? m : `<img${/\sposter\s*=\s*(?:"[^"]*"|'[^']*')/i.exec(m)?.[0].replace(/^\s*poster/i, ' src') ?? ''}>`))
    const refs = new Set<string>([doc])
    for (const link of documentLinks(shown)) {
      const rel = partOf(link)
      if (rel) refs.add(rel)
    }
    const later = new Set(deferredMediaLinks(html).map(partOf).filter((rel): rel is string => rel !== undefined && !refs.has(rel)))
    const deferred = [...later].map((file) => ({ file, raw: (out.files.get(file) as Uint8Array).length }))
    let raw = 0
    let gzip = 0
    for (const rel of refs) {
      raw += (out.files.get(rel) as Uint8Array).length
      gzip += gzipped(rel)
    }
    return { document: doc, address: `${out.base}${documentAddress(doc)}`, raw, gzip, files: refs.size - 1, overBudget: gzip > budgetKb * 1024, deferred }
  })
}

const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`

export interface CheckDeps {
  readonly loadPlaywright?: PlaywrightLoader
}

/**
 * The app folder a build was made from, so its records and sign-in can be
 * served: `--app` when given; the build's own folder (`<app>/.pwf/out`); else
 * the folder pwf runs in or the one around the build, when its pwpack.json id
 * is the build's (`pwpack/project.json` id). Null when none is.
 */
export async function appForBuild(target: string, out: BuiltOutput, cwd: string, explicit?: string): Promise<{ app: string | null }> {
  if (explicit !== undefined) {
    const app = resolveFrom(cwd, explicit)
    if (!(await isAppFolder(app))) throw new UsageError(`--app ${explicit} is not an app folder (no pwpack.json with an "app")`)
    return { app }
  }
  const own = await appFolderOf(target)
  if (own) return { app: own }
  if (out.id === undefined) return { app: null }
  for (const dir of [cwd, dirname(target)]) {
    if (!(await isAppFolder(dir))) continue
    try {
      const identity = JSON.parse(await readFile(join(dir, 'pwpack.json'), 'utf8')) as { id?: unknown }
      if (identity.id === out.id) return { app: dir }
    } catch {
      // not readable: not this build's
    }
  }
  return { app: null }
}

/** What --hydration says when the build's app folder is not known. */
const NO_APP_NOTE =
  'records: the app folder of this build is not known (built with --out into another folder?), so a page that reads records or signs in is served none: pass --app <dir>'

async function runHydration(io: CommandIO, target: string, out: BuiltOutput, widths: number[], loader: PlaywrightLoader, appFlag?: string): Promise<{ ok: boolean; lines: string[]; missing?: boolean }> {
  const chromium = await loader(io.cwd)
  if (!chromium) return { ok: false, lines: [PLAYWRIGHT_MISSING], missing: true }
  const html = new TextDecoder().decode(out.files.get('index.html'))
  const data = /<script type="application\/json" id="pw-first-paint">(.*?)<\/script>/s.exec(html)?.[1]
  if (!data) return { ok: true, lines: ['hydration: no static first paint (an app that requires sign-in): nothing to check'] }
  const first = JSON.parse(data) as { pages: Record<string, unknown>; entry?: string; notFound?: string }
  const { app } = await appForBuild(target, out, io.cwd, appFlag)
  if (!app) io.err(NO_APP_NOTE)
  const host = app ? await readOnlyHostFor(app) : undefined
  const server = await startStaticServer({ source: await openRunSource(target), port: 0, hostname: '127.0.0.1', hostPrefix: HOST_PREFIX, ...(host ? { host } : {}) })
  const lines: string[] = []
  let ok = true
  const browser = await chromium.launch()
  try {
    const origin = server.url.replace(/\/$/, '')
    const addressOf = (key: string): string =>
      out.router === 'path' ? (key === first.notFound ? '/pw-check-no-such-page' : key === first.entry ? '/' : `/${key}/`) : `/#/${key}`
    for (const key of Object.keys(first.pages)) {
      const info = { ...recordPageInfo(out.label, key, app), ...(first.notFound ? { notFoundKey: first.notFound } : {}) }
      for (const width of widths) {
        const { problems, skipped } = await checkPage(browser, origin, key, info, width, addressOf(key))
        if (problems.length > 0) ok = false
        lines.push(`${problems.length > 0 ? 'FAIL' : skipped ? 'skip' : 'ok  '} ${addressOf(key)}${info.query} @${width}${skipped ? ` (${skipped})` : ''}${problems.map((p) => `\n       ${p}`).join('')}`)
      }
    }
  } finally {
    await browser.close()
    await server.close()
  }
  return { ok, lines }
}

export async function runCheck(args: ParsedArgs, io: CommandIO, deps: CheckDeps = {}): Promise<number> {
  if (args.positionals.length > 1) throw new UsageError(`unexpected argument "${args.positionals[1]}"`)
  const target = resolveFrom(io.cwd, args.positionals[0] ?? '.')
  const some = ['links', 'weight', 'hydration'].some((f) => boolFlag(args, f))
  const links = some ? boolFlag(args, 'links') : true
  const weight = some ? boolFlag(args, 'weight') : true
  const hydration = boolFlag(args, 'hydration')
  const budgetFlag = stringFlag(args, 'budget')
  const budget = budgetFlag === undefined ? DEFAULT_BUDGET_KB : Number(budgetFlag)
  if (!(budget > 0)) throw new UsageError('--budget takes kilobytes, a number above 0')
  const widthsFlag = stringFlag(args, 'widths')
  const widths = widthsFlag === undefined ? [390] : widthsFlag.split(',').map((w) => Number(w.trim()))
  if (widths.some((w) => !Number.isInteger(w) || w < 200 || w > 4000)) throw new UsageError('--widths takes window widths in pixels, e.g. 390,1440')
  const originFlag = stringFlag(args, 'origin')
  const out = await readBuiltOutput(target)
  const report: Record<string, unknown> = { output: out.label, router: out.router, base: out.base }
  let ok = true
  if (links) {
    const r = brokenLinks(out, originFlag)
    report['links'] = r
    if (r.broken.length > 0) ok = false
  }
  if (weight) {
    const w = documentWeights(out, budget)
    report['weight'] = { budgetKb: budget, documents: w }
    if (w.some((d) => d.overBudget)) ok = false
  }
  let hydrationLines: string[] = []
  let playwrightMissing = false
  if (hydration) {
    const h = await runHydration(io, resolve(target), out, widths, deps.loadPlaywright ?? loadPlaywright, stringFlag(args, 'app'))
    hydrationLines = h.lines
    playwrightMissing = h.missing === true
    report['hydration'] = { ok: h.ok, lines: h.lines }
    if (!h.ok) ok = false
  }
  if (boolFlag(args, 'json')) {
    io.out(JSON.stringify({ ok, ...report }, null, 2))
    return ok ? 0 : 1
  }
  io.out(`${out.label} (${out.router} routing, base ${out.base})`)
  if (links) {
    const r = report['links'] as ReturnType<typeof brokenLinks>
    io.out(`links: ${r.checked} checked, ${r.broken.length} broken`)
    for (const b of r.broken) io.err(`  BROKEN ${b.document}: ${b.link} — ${b.why}`)
  }
  if (weight) {
    io.out(`weight (budget ${budget} KB gzipped per page):`)
    for (const d of (report['weight'] as { documents: DocumentWeight[] }).documents) {
      const line = `  ${d.address.padEnd(24)} ${kb(d.raw).padStart(10)} raw ${kb(d.gzip).padStart(10)} gzip  (${d.files} file${d.files === 1 ? '' : 's'})${d.overBudget ? '  OVER BUDGET' : ''}`
      if (d.overBudget) io.err(line)
      else io.out(line)
      for (const m of d.deferred) io.out(`    ${m.file.padEnd(22)} ${kb(m.raw).padStart(10)} raw, not counted: the browser loads it when it plays`)
    }
    io.out('  counts the document and the files it names; block modules a page loads later are not in it')
  }
  if (hydration) {
    if (playwrightMissing) io.err(`hydration: ${hydrationLines[0]}`)
    else for (const line of hydrationLines) io.out(line)
  }
  return ok ? 0 : 1
}

export const check: Command = {
  name: 'check',
  summary: 'Check a built pwapp: broken internal links, page weight, hydration of the first paint',
  usage: `pwf check [out] [--links] [--weight] [--hydration] [--budget <KB>] [--app <dir>] [--widths <px,…>] [--origin <url>] [--json]

  out            the built pwapp: a folder with index.html, an app folder (its
                 .pwf/out) or a .pwapp (default: the current folder)
  --links        every internal href, src and srcset of every page document
                 names what the build serves: a file, a page's document, a
                 hash route or per-locale address of the app, or a _redirects
                 rule landing on one; relative links resolve against <base href>
  --weight       each page document with the scripts, styles, preloads and
                 images it names, raw and gzipped, against --budget; a
                 video or audio file it does not autoplay or preload is
                 listed apart, not counted (its poster is)
  --budget <KB>  the gzipped weight a page may have (default ${DEFAULT_BUDGET_KB})
  --hydration    open every painted page in Chromium and check that hydration
                 adopts the first frame (the engine's hydration check). Needs
                 Playwright beside the app or pwf (an optional peer); without
                 it pwf says how to install it and exits 1. A page that
                 draws the not-found page where it was expected fails
  --app <dir>    the app folder the build was made from, for --hydration to
                 serve its records and sign-in (found by itself for .pwf/out,
                 and for the folder pwf runs in when its id is the build's)
  --widths <px>  window widths for --hydration (default 390)
  --origin <url> the app's public origin: absolute links on it count as internal
  --json         the result as data

Without --links, --weight or --hydration: links and weight. Links to other
origins are not followed (pwf makes no network request). Under --hydration a
build made with --base other than / is served at the root, so its addresses
do not match: check such a build without --base. Exit 1 when a link is
broken, a page is over budget or a page fails hydration.`,
  run: (args, io) => guard('check', io, () => runCheck(args, io)),
}
