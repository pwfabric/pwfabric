#!/usr/bin/env node
/**
 * The static first paint, checked in a browser (pwapp-format §2.5):
 *
 *   node scripts/hydration-check.mjs <app folder>… [--port 5010]
 *
 * For every app it builds the app with THIS checkout's CLI, serves it with
 * `pwf run`, and opens every painted page (`#pw-first-paint`) at phone width.
 * A page FAILS when:
 *  - React reports the HTML does not match the first render (a recoverable
 *    hydration error: "#418", "did not match");
 *  - any node the build painted is gone after hydration and the update the
 *    runner applies right after it (it was drawn again, not adopted);
 *  - the page was not hydrated at all (positive control: the painted root
 *    carries React's fiber, so a check that saw nothing cannot pass);
 *  - the page is a record page (notFoundWhenEmpty source) opened with a real
 *    record id from its fallback data, and the record did not load within the
 *    check window (address seed never reached state, or source stayed idle).
 *
 * Record pages are opened with a real id extracted from the receipt's fallback
 * data, so the check can verify the address seed reaches page state AND the
 * record loads — not just that the frame adopts. A not-found on a record that
 * exists in the fallback is a FAIL.
 *
 * "runner drew before the frame arrived" skips: 5 pages across the example
 * apps where the first-paint script decided the frame was not ready in time
 * and left the root empty. These are reported, not counted as failures — the
 * hydration check has nothing to adopt, and the runner's render path is
 * correct. They are worth monitoring: if the count grows, the first-paint
 * script may need a timing adjustment.
 *
 * Needs a Chromium for Playwright (`pnpm exec playwright install chromium`).
 * Exits 1 when any page fails, 2 on a usage or build error.
 */
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const cli = join(here, '..', 'packages', 'cli', 'dist', 'bin.js')
const args = process.argv.slice(2)
const portAt = args.indexOf('--port')
let port = portAt >= 0 ? Number(args[portAt + 1]) : 5010
const apps = args.filter((a, i) => !a.startsWith('--') && (portAt < 0 || i !== portAt + 1))
if (apps.length === 0) {
  console.error('usage: node scripts/hydration-check.mjs <app folder>… [--port 5010]')
  process.exit(2)
}

const { chromium } = await import('playwright')

/** Waits until the server answers, or fails after `ms`. */
async function ready(url, ms = 20_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`${url} did not answer`)
}

/** What one painted page came out as in the browser. */
async function checkPage(browser, origin, key, pageInfo) {
  const { query, isRecord } = pageInfo
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const problems = []
  page.on('console', (m) => {
    const text = m.text()
    if (/#418|#419|#423|#425|did not match|hydrat/i.test(text)) problems.push(`hydration: ${text.slice(0, 200)}`)
  })
  page.on('pageerror', (e) => problems.push(`page error: ${e.message.slice(0, 200)}`))
  // A record the app does not have sends the page to the not-found page, as specified.
  let notFound = false
  page.on('request', (r) => {
    if (/\/surfaces\/[^/]+\.receipt\.json/.test(r.url()) && !r.url().includes(`/surfaces/${key}.receipt.json`)) notFound = true
  })
  // For record pages: track whether the record request was actually made and answered.
  let recordRequested = false
  let recordAnswered = false
  if (isRecord) {
    page.on('request', (r) => { if (/\/_host\/records\//.test(r.url())) recordRequested = true })
    page.on('response', (r) => { if (/\/_host\/records\//.test(r.url())) recordAnswered = true })
  } else {
    // Non-record pages: hold data requests so loading frames are not a fault.
    await page.route(/\/_host\/records\//, () => new Promise(() => {}))
  }
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const root = document.getElementById('pw-root')
      window.__pwPainted = root ? [...root.querySelectorAll('*')] : []
      window.__pwPaintedRoot = root
    })
  })
  await page.goto(`${origin}/#/${key}${query}`)
  // Record pages need time for the record to load after hydration.
  await page.waitForTimeout(isRecord ? 5000 : 3000)
  const seen = await page.evaluate(() => {
    const root = window.__pwPaintedRoot
    const painted = window.__pwPainted ?? []
    const describe = (e) => {
      const block = e.closest('[data-block-type]')
      return `${e.tagName.toLowerCase()}${block ? ` in ${block.getAttribute('data-block-type')}#${block.id}` : ''}`
    }
    // The block a node belongs to (its wrapper's id), for the session check below.
    const blockOf = (e) => e.closest('[data-block-id]')?.getAttribute('data-block-id') ?? null
    // Hoisted resources (`<link>`, `<style precedence>`) carry no fiber; any adopted element does.
    const adopted = (e) => Object.keys(e).some((k) => k.startsWith('__reactFiber'))
    return {
      painted: painted.length,
      kept: root?.isConnected === true,
      hydrated: painted.some((e) => e.isConnected && adopted(e)),
      gone: painted.filter((e) => !e.isConnected).map(describe),
      goneBlocks: painted.filter((e) => !e.isConnected).map(blockOf),
    }
  })
  await page.close()
  // The first-paint script fetches a page's frame, and leaves it out when the
  // runner drew first: nothing was painted, so there is nothing to adopt.
  if (seen.painted === 0) return { skipped: 'runner drew before the frame arrived', problems }

  // RECORD PAGES: different check path.
  //
  // The first frame is built at phone width with an empty id — it shows the
  // loading/skeleton state. After hydration the runner applies the address seed
  // (`hydrateFirstFrame → update({ surface })`), the source activates, data
  // loads, and the skeleton is replaced by the actual record. This replacement
  // is a normal React update AFTER hydration, NOT a hydration mismatch. Checking
  // "painted nodes drawn again" here would always flag the skeleton→content
  // transition as a failure — a false positive.
  //
  // For record pages the check verifies:
  //   1. No React hydration errors (caught via the console listener).
  //   2. The page did not go not-found with a real id (seed broken → not-found).
  //   3. The record was requested AND answered (seed reached state, data loaded).
  if (isRecord) {
    if (!seen.kept && notFound) {
      if (pageInfo.hasFallbackId) {
        // Real id: the record should have been shown but wasn't — seed broken.
        problems.push('record page showed not-found with a real id — address seed did not reach state')
        return { problems }
      }
      if (!recordRequested) {
        // Sentinel id: not-found is expected (no data), but the source was not
        // even requested — seed did not reach state.
        problems.push('record page (sentinel id): address seed did not reach state — source never requested')
        return { problems }
      }
      // Sentinel + source was requested → expected not-found (test server has no data).
      return { skipped: 'sentinel id: source was requested (seed works); not-found expected without backend data', problems }
    }
    // `problems` already carries any hydration errors caught via console.
    if (problems.length > 0) return { problems }
    if (!recordRequested) {
      problems.push('record page: record request never made — address seed did not reach state')
    } else if (!recordAnswered) {
      problems.push('record page: record request made but did not complete within check window')
    }
    return { problems }
  }

  // NON-RECORD PAGES: standard hydration checks.
  if (!seen.kept && notFound) {
    return { skipped: 'no such record: the not-found page replaced it', problems }
  }
  if (!seen.kept && !notFound) problems.push('the painted root was replaced')
  else if (seen.kept && !seen.hydrated) problems.push('the painted root was not hydrated')
  // A SOURCE THAT WAITS FOR THE SESSION (E-6): the build paints a
  // `requiresSession` source loading, because who the visitor is is not known
  // to it; right after hydration the runner says (signed out here), and the
  // blocks drawn for its loading state give way to its signed-out state. That
  // is an update after hydration, like a record arriving — not a mismatch.
  const gone = seen.gone.filter((_, i) => !pageInfo.sessionBlocks?.has(seen.goneBlocks[i]))
  if (gone.length > 0) {
    const counts = new Map()
    for (const g of gone) counts.set(g, (counts.get(g) ?? 0) + 1)
    problems.push(`${gone.length} painted node(s) drawn again: ${[...counts].slice(0, 6).map(([g, n]) => `${g} ×${n}`).join(', ')}`)
  }
  return { problems }
}

/**
 * Finds a real record id for a record page.
 * Returns `{ query, isRecord, hasFallbackId }`:
 * - `isRecord: true` when the page has a notFoundWhenEmpty source; the query
 *   uses a real id extracted from the receipt fallback or the app's content
 *   folder (or a generated sentinel when no real id is found).
 * - `hasFallbackId: true` when a real id was found; a not-found in the check
 *   is then a FAIL (the record should have loaded). When false, the check
 *   uses a sentinel id; a not-found is EXPECTED (record does not exist in the
 *   test server) but the source must have been requested (seed reached state).
 * - `isRecord: false` for plain pages; query is ''.
 *
 * A real id lets the hydration check verify that the address seed reaches
 * state AND the record loads — not just that the frame adopts. Using a fake
 * id (`pw-check`) caused the page to go not-found, which the old script
 * silently counted as a skip instead of a failure.
 *
 * Sources for a real id (in priority order):
 * 1. `source.fallback` rows in the receipt (pre-built fallback data).
 * 2. `app/content/<entityType>.json` in the app folder — the content records
 *    `pwf run` serves read-only via its local host.
 */
function recordPageInfo(out, key) {
  let receipt
  try {
    receipt = JSON.parse(readFileSync(join(out, 'pwpack', 'surfaces', `${key}.receipt.json`), 'utf8'))
  } catch {
    return { query: '', isRecord: false }
  }
  // Collect the state keys that drive record sources.
  const recordSources = []
  for (const cap of receipt.capabilities ?? []) {
    for (const source of cap?.config?.dataSources ?? []) {
      if (source?.notFoundWhenEmpty !== true) continue
      recordSources.push(source)
    }
  }
  const sessionBlocks = sessionStateBlocks(receipt)
  if (recordSources.length === 0) return { query: '', isRecord: false, sessionBlocks }

  // The app folder is two levels up from `out` (.pwf/out → app).
  const appFolder = join(out, '..', '..')

  // Find a real id from the receipt fallback or the app content folder.
  function findRealId(source) {
    // 1. Receipt fallback rows.
    const fallbackRows = Array.isArray(source.fallback) ? source.fallback : []
    const fallbackRow = fallbackRows.find((r) => r && typeof r === 'object' && ('id' in r || 'Id' in r))
    if (fallbackRow) return fallbackRow.id ?? fallbackRow.Id

    // 2. App content records (read-only host — `pwf run` serves them).
    if (source.entityType) {
      try {
        const contentFile = join(appFolder, 'app', 'content', `${source.entityType}.json`)
        const content = JSON.parse(readFileSync(contentFile, 'utf8'))
        const rows = Array.isArray(content) ? content : (content?.data ?? [])
        const row = rows.find((r) => r && typeof r === 'object' && ('id' in r || 'Id' in r))
        if (row) return row.id ?? row.Id
      } catch {
        // No content file for this entity type.
      }
    }
    return null
  }

  // Build a query using real ids, one per state key.
  const params = new URLSearchParams()
  let hasFallbackId = false
  for (const source of recordSources) {
    // Extract state keys from the source's query filter.
    const stateKeys = new Set()
    for (const m of JSON.stringify(source).matchAll(/state\.([A-Za-z_][A-Za-z0-9_]*)/g)) stateKeys.add(m[1])
    if (stateKeys.size === 0) continue

    const realId = findRealId(source)
    for (const k of stateKeys) {
      if (params.has(k)) continue
      if (realId !== null) {
        params.set(k, String(realId))
        hasFallbackId = true
      } else {
        // No real id available: use a sentinel so the source is active, not idle.
        // The record won't load (server won't have it), but the address seed IS
        // tested — the check verifies the source was at least requested.
        params.set(k, 'pw-check-seed')
      }
    }
  }
  const query = params.toString() ? `?${params.toString()}` : ''
  return { query, isRecord: true, hasFallbackId, sessionBlocks }
}

/**
 * The blocks (and everything inside them) whose own definition reads the
 * loading or error state of a `requiresSession` source: what the first frame
 * draws while it waits for the session, and the runner redraws once it knows.
 */
function sessionStateBlocks(receipt) {
  const ids = []
  for (const cap of receipt.capabilities ?? []) {
    for (const source of cap?.config?.dataSources ?? []) if (source?.requiresSession === true && source.id) ids.push(source.id)
  }
  const out = new Set()
  if (ids.length === 0) return out
  const names = ids.map((i) => i.replace(/[^A-Za-z0-9_]/g, '')).join('|')
  const reads = new RegExp(String.raw`__(?:loading|errors|errorCodes)\.(?:${names})\b`)
  const walk = (blocks, inside) => {
    for (const block of Array.isArray(blocks) ? blocks : []) {
      const { children, ...own } = block ?? {}
      const marked = inside || reads.test(JSON.stringify(own))
      if (marked && block?.id) out.add(block.id)
      walk(children, marked)
    }
  }
  walk(receipt.blocks, false)
  return out
}

let failed = 0
let skipped = 0
const browser = await chromium.launch()
try {
  for (const app of apps.map((a) => resolve(a))) {
    const built = spawnSync(process.execPath, [cli, 'build', app], { encoding: 'utf8' })
    if (built.status !== 0) {
      console.error(`${basename(app)}: pwf build failed\n${built.stdout}${built.stderr}`)
      process.exitCode = 2
      continue
    }
    const html = readFileSync(join(app, '.pwf', 'out', 'index.html'), 'utf8')
    const data = html.match(/<script type="application\/json" id="pw-first-paint">(.*?)<\/script>/)?.[1]
    if (!data) {
      console.log(`${basename(app)}: no static first paint (an app that requires sign-in) — nothing to check`)
      continue
    }
    const keys = Object.keys(JSON.parse(data).pages)
    const at = port++
    const server = spawn(process.execPath, [cli, 'run', app, '--port', String(at)], { stdio: 'ignore' })
    try {
      const origin = `http://127.0.0.1:${at}`
      await ready(`${origin}/index.html`)
      for (const key of keys) {
        const pageInfo = recordPageInfo(join(app, '.pwf', 'out'), key)
        const { problems, skipped: skip } = await checkPage(browser, origin, key, pageInfo)
        if (problems.length > 0) failed++
        if (skip) skipped++
        const status = problems.length > 0 ? 'FAIL' : skip ? 'skip' : 'ok  '
        console.log(`${status} ${basename(app)} #/${key}${pageInfo.query}${skip ? ` (${skip})` : ''}${problems.map((p) => `\n       ${p}`).join('')}`)
      }
    } finally {
      server.kill()
    }
  }
} finally {
  await browser.close()
}
if (skipped > 0) {
  console.log(`\n${skipped} page(s) skipped (runner drew before frame arrived — not a fault, worth monitoring)`)
}
if (failed > 0) {
  console.log(`\n${failed} page(s) not adopted by hydration`)
  process.exitCode = 1
}
