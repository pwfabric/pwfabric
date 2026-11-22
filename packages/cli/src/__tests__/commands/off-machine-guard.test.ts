/**
 * The browser pwf check and pwf shoot drive reaches this machine only: a
 * page's fetch, WebSocket and popup to another host are all refused. Run in a
 * real Chromium when Playwright is installed (skipped otherwise), against a
 * second server on another address (127.0.0.2) that counts what reaches it —
 * first reached by an unguarded page, the positive control.
 */
import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchLocal, loadPlaywright, localPage, type Chromium } from '../../commands/lib/hydration.js'

const found = await loadPlaywright(process.cwd())
// Playwright and its browser both installed (a CI run without browsers skips).
const executable = (found as { executablePath?: () => string } | null)?.executablePath?.()
const chromium: Chromium | null = found && executable && existsSync(executable) ? found : null

let page: Server
let other: Server
let hits: string[] = []
let pageUrl = ''

const listen = (server: Server, host: string): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, host, () => resolve((server.address() as AddressInfo).port))
  })

beforeAll(async () => {
  if (!chromium) return
  other = createServer((req, res) => {
    hits.push(`http ${req.url}`)
    res.writeHead(200, { 'access-control-allow-origin': '*' })
    res.end('reached')
  })
  other.on('upgrade', (req, socket) => {
    hits.push(`ws ${req.url}`)
    socket.destroy()
  })
  const otherPort = await listen(other, '127.0.0.2')
  const external = `127.0.0.2:${otherPort}`
  page = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<!doctype html><script>
      fetch('http://${external}/fetch').catch(() => {})
      try { new WebSocket('ws://${external}/socket') } catch (e) {}
      window.open('http://${external}/popup')
    </script>`)
  })
  pageUrl = `http://127.0.0.1:${await listen(page, '127.0.0.1')}/`
})

afterAll(async () => {
  await Promise.all([page, other].filter(Boolean).map((s) => new Promise((r) => s.close(r))))
})

describe.skipIf(!chromium)('the check browser', () => {
  it('lets an unguarded page reach the other host (positive control)', async () => {
    hits = []
    const browser = await (chromium as Chromium).launch()
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
      const p = await context.newPage()
      await p.goto(pageUrl)
      await p.waitForTimeout(1500)
      await context.close()
    } finally {
      await browser.close()
    }
    expect(hits.sort()).toEqual(['http /fetch', 'http /popup', 'ws /socket'])
  }, 60_000)

  it('refuses a fetch, a WebSocket and a popup to another host', async () => {
    hits = []
    const browser = await launchLocal(chromium as Chromium)
    try {
      const { page: p, done } = await localPage(browser, { width: 390, height: 844 })
      await p.goto(pageUrl)
      await p.waitForTimeout(1500)
      await done()
    } finally {
      await browser.close()
    }
    expect(hits).toEqual([])
  }, 60_000)
})
