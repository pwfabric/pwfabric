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
 *    carries React's fiber, so a check that saw nothing cannot pass).
 *
 * The app's records are held — every `<host>/records/…` request stays
 * unanswered — so each source is still loading when the page is checked: a
 * loading frame that data replaces later is not a hydration fault.
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
async function checkPage(browser, origin, key, query) {
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
  // Data stays loading: what replaces a loading frame later is not a fault.
  await page.route(/\/_host\/records\//, () => new Promise(() => {}))
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const root = document.getElementById('pw-root')
      window.__pwPainted = root ? [...root.querySelectorAll('*')] : []
      window.__pwPaintedRoot = root
    })
  })
  await page.goto(`${origin}/#/${key}${query}`)
  await page.waitForTimeout(3000)
  const seen = await page.evaluate(() => {
    const root = window.__pwPaintedRoot
    const painted = window.__pwPainted ?? []
    const describe = (e) => {
      const block = e.closest('[data-block-type]')
      return `${e.tagName.toLowerCase()}${block ? ` in ${block.getAttribute('data-block-type')}#${block.id}` : ''}`
    }
    // Hoisted resources (`<link>`, `<style precedence>`) carry no fiber; any adopted element does.
    const adopted = (e) => Object.keys(e).some((k) => k.startsWith('__reactFiber'))
    return {
      painted: painted.length,
      kept: root?.isConnected === true,
      hydrated: painted.some((e) => e.isConnected && adopted(e)),
      gone: painted.filter((e) => !e.isConnected).map(describe),
    }
  })
  await page.close()
  // The first-paint script fetches a page's frame, and leaves it out when the
  // runner drew first: nothing was painted, so there is nothing to adopt.
  if (seen.painted === 0) return { skipped: 'the runner drew before the frame arrived', problems }
  if (!seen.kept && notFound) return { skipped: 'no such record: the not-found page replaced it', problems }
  {
    if (!seen.kept) problems.push('the painted root was replaced')
    else if (!seen.hydrated) problems.push('the painted root was not hydrated')
    if (seen.gone.length > 0) {
      const counts = new Map()
      for (const g of seen.gone) counts.set(g, (counts.get(g) ?? 0) + 1)
      problems.push(`${seen.gone.length} painted node(s) drawn again: ${[...counts].slice(0, 6).map(([g, n]) => `${g} ×${n}`).join(', ')}`)
    }
  }
  return { problems }
}

/**
 * The query a record page is opened with: each state key its record source
 * reads (`notFoundWhenEmpty`), so the page waits for its record (held)
 * instead of going to the not-found page at once — no id names no record.
 */
function recordQuery(out, key) {
  let receipt
  try {
    receipt = JSON.parse(readFileSync(join(out, 'pwpack', 'surfaces', `${key}.receipt.json`), 'utf8'))
  } catch {
    return ''
  }
  const keys = new Set()
  for (const cap of receipt.capabilities ?? []) {
    for (const source of cap?.config?.dataSources ?? []) {
      if (source?.notFoundWhenEmpty !== true) continue
      for (const m of JSON.stringify(source).matchAll(/state\.([A-Za-z_][A-Za-z0-9_]*)/g)) keys.add(m[1])
    }
  }
  return keys.size > 0 ? `?${[...keys].map((k) => `${k}=pw-check`).join('&')}` : ''
}

let failed = 0
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
        const query = recordQuery(join(app, '.pwf', 'out'), key)
        const { problems, skipped } = await checkPage(browser, origin, key, query)
        if (problems.length > 0) failed++
        const status = problems.length > 0 ? 'FAIL' : skipped ? 'skip' : 'ok  '
        console.log(`${status} ${basename(app)} #/${key}${query}${skipped ? ` (${skipped})` : ''}${problems.map((p) => `\n       ${p}`).join('')}`)
      }
    } finally {
      server.kill()
    }
  }
} finally {
  await browser.close()
}
if (failed > 0) {
  console.log(`\n${failed} page(s) not adopted by hydration`)
  process.exitCode = 1
}
