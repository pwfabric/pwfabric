/**
 * The first paint checked in a browser (pwapp-format §2.5): the logic of the
 * engine's `scripts/hydration-check.mjs`, for `pwf check --hydration`.
 *
 * Every painted page (`#pw-first-paint`) is opened in Chromium through
 * Playwright, served as `pwf run` serves it, and FAILS when React reports
 * the HTML did not match its first render, when a painted node is gone after
 * hydration (drawn again, not adopted), when the painted root was not
 * hydrated at all (the positive control: the root carries React's fiber), or
 * when the frame's stylesheet (`#pw-static-layout`) outlives the update
 * that brings the page to the window's width. A record page is opened with a
 * real id from its fallback rows or the app's content, and must load it.
 *
 * Playwright is an optional peer: {@link loadPlaywright} finds it beside the
 * app or beside pwf, and answers null when neither has it.
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The part of Playwright this check drives. */
export interface Chromium {
  launch(): Promise<Browser>
}
interface Browser {
  newPage(options: { viewport: { width: number; height: number } }): Promise<Page>
  close(): Promise<void>
}
interface Page {
  on(event: string, handler: (x: never) => void): void
  route(url: RegExp, handler: () => Promise<void>): Promise<void>
  addInitScript(script: string): Promise<void>
  goto(url: string): Promise<unknown>
  waitForTimeout(ms: number): Promise<void>
  evaluate<T>(expression: string): Promise<T>
  screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>
  emulateMedia(options: { colorScheme: 'light' | 'dark' }): Promise<void>
  close(): Promise<void>
}

export type PlaywrightLoader = (cwd: string) => Promise<Chromium | null>

/** The line printed when Playwright is not installed. */
export const PLAYWRIGHT_MISSING =
  'Playwright is not installed. It is an optional peer of pwf: install it beside the app (npm i -D playwright, or pnpm add -D playwright), then its browser (npx playwright install chromium).'

/** Finds `playwright` beside the app (resolved from `cwd`), else beside pwf; null when neither has it. */
export const loadPlaywright: PlaywrightLoader = async (cwd) => {
  const tries: (() => Promise<unknown>)[] = [
    async () => {
      const from = existsSync(join(cwd, 'package.json')) ? join(cwd, 'package.json') : join(cwd, 'noop.js')
      return import(pathToFileURL(createRequire(from).resolve('playwright')).href)
    },
    // A specifier held in a variable: a bundler or the type checker does not require it.
    async () => {
      const name = 'playwright'
      return import(name)
    },
  ]
  for (const attempt of tries) {
    try {
      const mod = (await attempt()) as { chromium?: Chromium; default?: { chromium?: Chromium } }
      const chromium = mod.chromium ?? mod.default?.chromium
      if (chromium) return chromium
    } catch {
      // not there
    }
  }
  return null
}

interface PageInfo {
  readonly query: string
  readonly isRecord: boolean
  readonly hasFallbackId?: boolean
  readonly sessionBlocks?: Set<string>
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v)
const sourcesOf = (receipt: Json): Json[] =>
  (Array.isArray(receipt['capabilities']) ? receipt['capabilities'] : [])
    .filter(isObj)
    .flatMap((c) => (isObj(c['config']) && Array.isArray(c['config']['dataSources']) ? c['config']['dataSources'] : []))
    .filter(isObj)

/** The blocks whose own definition reads the loading or error state of a `requiresSession` source. */
function sessionStateBlocks(receipt: Json): Set<string> {
  const ids = sourcesOf(receipt).filter((s) => s['requiresSession'] === true && typeof s['id'] === 'string').map((s) => String(s['id']))
  const out = new Set<string>()
  if (ids.length === 0) return out
  const names = ids.map((i) => i.replace(/[^A-Za-z0-9_]/g, '')).join('|')
  const reads = new RegExp(String.raw`__(?:loading|errors|errorCodes)\.(?:${names})\b`)
  const walk = (blocks: unknown, inside: boolean): void => {
    for (const block of Array.isArray(blocks) ? blocks : []) {
      if (!isObj(block)) continue
      const { children, ...own } = block
      const marked = inside || reads.test(JSON.stringify(own))
      if (marked && typeof block['id'] === 'string') out.add(block['id'])
      walk(children, marked)
    }
  }
  walk(receipt['blocks'], false)
  return out
}

/** Whether a page is a record page, and the query that opens it with a real record id. */
export function recordPageInfo(out: string, key: string, app: string | null): PageInfo {
  let receipt: Json
  try {
    receipt = JSON.parse(readFileSync(join(out, 'pwpack', 'surfaces', `${key}.receipt.json`), 'utf8')) as Json
  } catch {
    return { query: '', isRecord: false }
  }
  const sessionBlocks = sessionStateBlocks(receipt)
  const recordSources = sourcesOf(receipt).filter((s) => s['notFoundWhenEmpty'] === true)
  if (recordSources.length === 0) return { query: '', isRecord: false, sessionBlocks }
  const realId = (source: Json): unknown => {
    const row = (Array.isArray(source['fallback']) ? source['fallback'] : []).find((r) => isObj(r) && 'id' in r) as Json | undefined
    if (row) return row['id']
    if (app && typeof source['entityType'] === 'string') {
      try {
        const content = JSON.parse(readFileSync(join(app, 'app', 'content', `${source['entityType']}.json`), 'utf8')) as unknown
        const rows = Array.isArray(content) ? content : isObj(content) && Array.isArray(content['data']) ? content['data'] : []
        const r = rows.find((x: unknown) => isObj(x) && 'id' in x) as Json | undefined
        if (r) return r['id']
      } catch {
        // no content for this type
      }
    }
    return null
  }
  const params = new URLSearchParams()
  let hasFallbackId = false
  for (const source of recordSources) {
    const keys = new Set([...JSON.stringify(source).matchAll(/state\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1] as string))
    const id = realId(source)
    for (const k of keys) {
      if (params.has(k)) continue
      if (id !== null && id !== undefined) {
        params.set(k, String(id))
        hasFallbackId = true
      } else params.set(k, 'pw-check-seed')
    }
  }
  const query = params.toString() ? `?${params.toString()}` : ''
  return { query, isRecord: true, hasFallbackId, sessionBlocks }
}

interface Seen {
  layoutLeft: boolean
  painted: number
  kept: boolean
  hydrated: boolean
  gone: string[]
  goneBlocks: (string | null)[]
}

/** One painted page at one width: its problems, or why it was skipped. */
export async function checkPage(browser: Browser, origin: string, key: string, info: PageInfo, width: number, address: string): Promise<{ problems: string[]; skipped?: string }> {
  const page = await browser.newPage({ viewport: { width, height: 844 } })
  const problems: string[] = []
  page.on('console', ((m: { text(): string }) => {
    const t = m.text()
    if (/#418|#419|#423|#425|did not match|hydrat/i.test(t)) problems.push(`hydration: ${t.slice(0, 200)}`)
  }) as (x: never) => void)
  page.on('pageerror', ((e: Error) => problems.push(`page error: ${e.message.slice(0, 200)}`)) as (x: never) => void)
  let notFound = false
  page.on('request', ((r: { url(): string }) => {
    if (/\/surfaces\/[^/]+\.receipt\.json/.test(r.url()) && !r.url().includes(`/surfaces/${key}.receipt.json`)) notFound = true
  }) as (x: never) => void)
  let requested = false
  let answered = false
  if (info.isRecord) {
    page.on('request', ((r: { url(): string }) => {
      if (/\/_host\/records\//.test(r.url())) requested = true
    }) as (x: never) => void)
    page.on('response', ((r: { url(): string }) => {
      if (/\/_host\/records\//.test(r.url())) answered = true
    }) as (x: never) => void)
  } else {
    await page.route(/\/_host\/records\//, () => new Promise<void>(() => {}))
  }
  // Browser code, as text: it runs in the page, not here.
  await page.addInitScript(`document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('pw-root')
    window.__pwPainted = root ? [...root.querySelectorAll('*')] : []
    window.__pwPaintedRoot = root
  })`)
  await page.goto(`${origin}${address}${info.query}`)
  await page.waitForTimeout(info.isRecord ? 5000 : 3000)
  const seen = await page.evaluate<Seen>(`(() => {
    const root = window.__pwPaintedRoot
    const painted = window.__pwPainted ?? []
    const describe = (e) => {
      const block = e.closest('[data-block-type]')
      return e.tagName.toLowerCase() + (block ? ' in ' + block.getAttribute('data-block-type') + '#' + block.id : '')
    }
    const adopted = (e) => Object.keys(e).some((k) => k.startsWith('__reactFiber'))
    return {
      layoutLeft: Boolean(document.getElementById('pw-static-layout')),
      painted: painted.length,
      kept: root?.isConnected === true,
      hydrated: painted.some((e) => e.isConnected && adopted(e)),
      gone: painted.filter((e) => !e.isConnected).map(describe),
      goneBlocks: painted.filter((e) => !e.isConnected).map((e) => e.closest('[data-block-id]')?.getAttribute('data-block-id') ?? null),
    }
  })()`)
  await page.close()
  if (seen.painted === 0) return { skipped: 'the runner drew before the frame arrived', problems }
  if (info.isRecord) {
    if (!seen.kept && notFound) {
      if (info.hasFallbackId) return { problems: [...problems, 'record page showed not-found with a real id: the address did not reach the page state'] }
      if (!requested) return { problems: [...problems, 'record page: the source was never requested'] }
      return { skipped: 'no record id to open it with: not-found expected', problems }
    }
    if (problems.length > 0) return { problems }
    if (!requested) problems.push('record page: the record was never requested')
    else if (!answered) problems.push('record page: the record did not arrive within the check window')
    return { problems }
  }
  if (!seen.kept && notFound) return { skipped: 'the not-found page replaced it', problems }
  if (seen.layoutLeft) problems.push('the frame’s stylesheet (#pw-static-layout) is still in the document after the update')
  if (!seen.kept && !notFound) problems.push('the painted root was replaced')
  else if (seen.kept && !seen.hydrated) problems.push('the painted root was not hydrated')
  const gone = seen.gone.filter((_, i) => !info.sessionBlocks?.has(seen.goneBlocks[i] as string))
  if (gone.length > 0) {
    const counts = new Map<string, number>()
    for (const g of gone) counts.set(g, (counts.get(g) ?? 0) + 1)
    problems.push(`${gone.length} painted node(s) drawn again: ${[...counts].slice(0, 6).map(([g, n]) => `${g} ×${n}`).join(', ')}`)
  }
  return { problems }
}

export type { Browser, Page }
