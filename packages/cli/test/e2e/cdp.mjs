// A minimal Chrome DevTools Protocol client: Node built-ins and the global
// WebSocket (Node 22) only — no Playwright, no Puppeteer.
//
//   const browser = await launchChrome()       // headless, throwaway profile
//   const page = await browser.newPage()
//   await page.goto('http://127.0.0.1:4600/')
//   await page.waitFor('document.querySelector("h1")?.textContent')
//   await browser.close()
//
// The page records console errors, uncaught exceptions and every response
// with a status of 400 or more, so a scenario can assert the page was clean.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Where Chrome usually lives; `CHROME_PATH` wins. */
export function findChrome(env = process.env) {
  const candidates = [
    env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : undefined,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ]
  return candidates.find((p) => typeof p === 'string' && p && existsSync(p)) ?? null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function devToolsPort(profile, child, timeoutMs) {
  const file = join(profile, 'DevToolsActivePort')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`chrome exited with code ${child.exitCode}`)
    const text = await readFile(file, 'utf8').catch(() => '')
    const [port, path] = text.split('\n')
    if (port && path) return { port: Number(port), path: path.trim() }
    await sleep(50)
  }
  throw new Error('chrome did not open a DevTools port')
}

class Connection {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Set()
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString('utf8'))
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`))
        else p.resolve(msg.result)
        return
      }
      for (const l of this.listeners) l(msg)
    })
  }

  static open(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      ws.addEventListener('open', () => resolve(new Connection(ws)), { once: true })
      ws.addEventListener('error', () => reject(new Error(`cannot connect to ${url}`)), { once: true })
    })
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  on(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close() {
    this.ws.close()
  }
}

class Page {
  constructor(conn, sessionId) {
    this.conn = conn
    this.sessionId = sessionId
    this.consoleErrors = []
    this.exceptions = []
    this.failedResponses = []
    // Content Security Policy: what the browser reported (Log, source
    // "security") and which requests it blocked (Network.loadingFailed with
    // blockedReason "csp"). Kept apart from the other problems so a scenario
    // can count them on their own.
    this.cspViolations = []
    this.cspBlocked = []
    this.requests = []
    this.inflight = new Set()
    this.lastActivity = Date.now()
    conn.on((msg) => {
      if (msg.sessionId !== sessionId) return
      const p = msg.params
      if (msg.method === 'Network.requestWillBeSent') this.inflight.add(p.requestId)
      if (msg.method === 'Network.loadingFinished' || msg.method === 'Network.loadingFailed') this.inflight.delete(p.requestId)
      if (msg.method?.startsWith('Network.')) this.lastActivity = Date.now()
      if (msg.method === 'Runtime.consoleAPICalled' && p.type === 'error') {
        this.consoleErrors.push(p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300))
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.exceptions.push((p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).slice(0, 300))
      } else if (msg.method === 'Network.requestWillBeSent') {
        this.requests.push({ method: p.request.method, url: p.request.url, headers: p.request.headers })
      } else if (msg.method === 'Network.responseReceived' && p.response.status >= 400) {
        this.failedResponses.push(`${p.response.status} ${p.response.url}`)
      } else if (msg.method === 'Log.entryAdded' && (p.entry.source === 'security' || /Content Security Policy/i.test(p.entry.text))) {
        this.cspViolations.push(p.entry.text.slice(0, 400))
      } else if (msg.method === 'Network.loadingFailed' && p.blockedReason === 'csp') {
        this.cspBlocked.push(p.requestId)
      }
    })
  }

  send(method, params) {
    return this.conn.send(method, params, this.sessionId)
  }

  async init() {
    await this.send('Page.enable')
    await this.send('Runtime.enable')
    await this.send('Network.enable')
    await this.send('Log.enable')
    // The page's own view of violations, in the order they happened.
    await this.send('Page.addScriptToEvaluateOnNewDocument', {
      source:
        "window.__cspViolations = []; document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push({ directive: e.effectiveDirective, blocked: e.blockedURI, sample: e.sample }))",
    })
  }

  /** Evaluates an expression in the page; resolves to its (JSON) value. */
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(`page threw: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
    return r.result.value
  }

  /** Navigates and waits for the load event. */
  async goto(url) {
    const loaded = new Promise((resolve) => {
      const off = this.conn.on((msg) => {
        if (msg.sessionId === this.sessionId && msg.method === 'Page.loadEventFired') {
          off()
          resolve()
        }
      })
    })
    await this.send('Page.navigate', { url })
    await loaded
  }

  async reload() {
    const loaded = new Promise((resolve) => {
      const off = this.conn.on((msg) => {
        if (msg.sessionId === this.sessionId && msg.method === 'Page.loadEventFired') {
          off()
          resolve()
        }
      })
    })
    await this.send('Page.reload', { ignoreCache: true })
    await loaded
  }

  /** Polls `expression` until it is truthy; resolves to its value. */
  async waitFor(expression, { timeoutMs = 20_000, what = expression } = {}) {
    const deadline = Date.now() + timeoutMs
    let last
    while (Date.now() < deadline) {
      // A DOM node cannot travel by value; it counts as "there".
      last = await this.evaluate(`(() => { const v = (${expression}); return v instanceof Node ? true : v })()`).catch((e) => e)
      if (last && !(last instanceof Error)) return last
      await sleep(50)
    }
    throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}${last instanceof Error ? ` (${last.message})` : ''}`)
  }

  /** Resolves once no request has been in flight for `quietMs` (or after `timeoutMs`). */
  async idle({ quietMs = 500, timeoutMs = 10_000 } = {}) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (this.inflight.size === 0 && Date.now() - this.lastActivity >= quietMs) return true
      await sleep(50)
    }
    return false
  }

  /** Content Security Policy reports since the last call (browser log + blocked requests + page events), then forgets them. */
  async takeCsp() {
    const page = (await this.evaluate('window.__cspViolations ? window.__cspViolations.splice(0) : []').catch(() => [])) ?? []
    const out = { log: this.cspViolations, blockedRequests: this.cspBlocked.length, page }
    this.cspViolations = []
    this.cspBlocked = []
    return out
  }

  /** What went wrong on the page since the last call, then forgets it. */
  takeProblems() {
    const out = { consoleErrors: this.consoleErrors, exceptions: this.exceptions, failedResponses: this.failedResponses }
    this.consoleErrors = []
    this.exceptions = []
    this.failedResponses = []
    return out
  }
}

/** Starts a headless Chrome with a throwaway profile. */
export async function launchChrome({ chrome = findChrome(), timeoutMs = 20_000 } = {}) {
  if (!chrome) throw new Error('no Chrome found; set CHROME_PATH')
  const profile = await mkdtemp(join(tmpdir(), 'pwf-e2e-chrome-'))
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--mute-audio',
    '--window-size=1280,900',
    ...(typeof process.getuid === 'function' && process.getuid() === 0 ? ['--no-sandbox'] : []),
    'about:blank',
  ]
  const child = spawn(chrome, args, { stdio: 'ignore' })
  let conn
  try {
    const { port, path } = await devToolsPort(profile, child, timeoutMs)
    conn = await Connection.open(`ws://127.0.0.1:${port}${path}`)
  } catch (e) {
    child.kill()
    await rm(profile, { recursive: true, force: true }).catch(() => undefined)
    throw e
  }
  const version = await conn.send('Browser.getVersion')
  return {
    version: version.product,
    async newPage() {
      const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true })
      const page = new Page(conn, sessionId)
      await page.init()
      return page
    },
    async close() {
      await conn.send('Browser.close').catch(() => undefined)
      conn.close()
      await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)))
      // Chrome may hold the profile a moment after it exits (Windows).
      for (let i = 0; i < 10; i++) {
        try {
          await rm(profile, { recursive: true, force: true })
          break
        } catch {
          await sleep(200)
        }
      }
    },
  }
}
