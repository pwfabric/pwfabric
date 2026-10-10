// End-to-end: the round-trip apps of the spec, through the built `pwf`
// binary, rendered in a real headless Chrome driven over CDP.
//
//   node test/e2e/run-e2e.mjs [--only l1,l2,l3,l3-dev,l3-loop,csp-probe,foundation] [--foundation <dir>]
//
// For each round-trip app (spec/roundtrip/<app>/input, copied to a temp dir):
//   pwf add <the fixture foundation>  (the pin must equal the spec's)
//   pwf validate                      exit 0
//   pwf build                         exit 0
//   pwf run .pwf/out --port 0         and the page renders what the receipts say
//
// l3-loop drives sign-in and data through the local host under `pwf dev`, on a
// copy of L3 extended with what the loop needs (see L3_LOOP below).
// `foundation` runs `pwf create --foundation <dir>` + `pwf dev` against a real
// foundation pack (--foundation or PWF_E2E_FOUNDATION).
//
// Prints progress lines, then ONE JSON line: { chrome, results: [...] } — or
// { skipped: "<reason>" } when there is no Chrome or no built CLI. Exit 1 when
// any scenario failed.
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findChrome, launchChrome } from './cdp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', '..')
const BIN = join(CLI, 'dist', 'bin.js')
const ROUNDTRIP = join(CLI, '..', '..', 'spec', 'roundtrip')

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const foundationDir = flag('foundation') ?? process.env.PWF_E2E_FOUNDATION
const only = new Set((flag('only') ?? `l1,l2,l3,l3-dev,l3-loop,csp-probe${foundationDir ? ',foundation' : ''}`).split(','))
const log = (line) => process.stdout.write(`${line}\n`)
const finish = (summary, code = 0) => {
  process.stdout.write(`${JSON.stringify(summary)}\n`)
  process.exit(code)
}

const chromePath = findChrome()
if (!chromePath) finish({ skipped: 'no Chrome found (set CHROME_PATH to run the browser end-to-end tests)' })
if (!existsSync(BIN)) finish({ skipped: `the CLI is not built (${BIN} is missing; run pnpm build)` })
if (!existsSync(ROUNDTRIP)) finish({ skipped: `the spec is not beside the engine (${ROUNDTRIP} is missing; it is a separate repository upstream)` })

// ── the CLI ──────────────────────────────────────────────────────────

/** Runs `pwf <args>` to completion. */
function pwf(args, cwd) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { cwd, timeout: 180_000 }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out: stdout, err: stderr })
    })
  })
}

/** Starts a serving command (`run`, `dev`) and resolves once it prints its address. */
function pwfServe(args, cwd, pattern) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`pwf ${args.join(' ')} printed no address in 120 s:\n${out}\n${err}`))
    }, 120_000)
    child.stderr.on('data', (d) => (err += d))
    child.stdout.on('data', (d) => {
      out += d
      const m = pattern.exec(out)
      if (m) {
        clearTimeout(timer)
        resolve({
          url: m[1],
          output: () => out,
          stop: () =>
            new Promise((done) => {
              if (child.exitCode !== null) return done()
              child.once('exit', () => done())
              child.kill('SIGINT')
            }),
        })
      }
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`pwf ${args.join(' ')} exited (${code}) before serving:\n${out}\n${err}`))
    })
  })
}

// ── checks ───────────────────────────────────────────────────────────

class Scenario {
  constructor(name) {
    this.name = name
    this.passed = []
    this.failed = []
    this.findings = []
    this.timings = {}
    this.csp = { checked: 0, violations: 0 }
  }
  check(what, ok, detail) {
    if (ok) this.passed.push(what)
    else this.failed.push(detail === undefined ? what : `${what}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
    return ok
  }
  rename(name) {
    this.name = name
  }
  note(finding) {
    this.findings.push(finding)
  }
  result() {
    return {
      name: this.name,
      ok: this.failed.length === 0,
      assertions: { passed: this.passed.length, failed: this.failed.length },
      timings: this.timings,
      csp: this.csp,
      failures: this.failed,
      findings: this.findings,
    }
  }
}

/** Times `fn` into `s.timings[key]` (ms). */
async function timed(s, key, fn) {
  const t0 = performance.now()
  const value = await fn()
  s.timings[key] = Math.round(performance.now() - t0)
  return value
}

// Row text blocks: `name` itself, or its per-item clones `name--<i>`.
const ROWS = '[...document.querySelectorAll(\'[data-block-type="text"][data-block-id^="name"]\')].map((e) => e.textContent)'
const GATE = 'Boolean(document.getElementById("pwapp-sign-in-gate"))'
const textOf = (selector) => `document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`

/**
 * On boot with nothing stored, the runner asks the gateway whether a provider
 * round trip left a cookie; for a visitor who has none, 401 is the ordinary
 * answer (session-protocol; runner `readGatewaySession`).
 */
const GATEWAY_401 = /^401 \S+\/_auth\/session$/

/**
 * A page left clean: no exception, no console error, no failed request
 * (except the ones `allowed` matches) and no Content Security Policy
 * violation — the built app carries its policy, so everything it does must
 * fit it.
 */
async function checkClean(s, page, label, allowed = () => false) {
  const csp = await page.takeCsp()
  const violations = csp.log.length + csp.page.length
  s.csp.checked++
  s.csp.violations += violations
  s.check(`${label}: zero CSP violations`, violations === 0 && csp.blockedRequests === 0, csp)
  const p = page.takeProblems()
  // An app without an identity carries no pwpack/auth.json; the runner must not ask for it.
  const failed = p.failedResponses.filter((r) => !allowed(r) && !GATEWAY_401.test(r))
  s.check(`${label}: no uncaught exception`, p.exceptions.length === 0, p.exceptions)
  s.check(`${label}: no console error`, p.consoleErrors.length === 0, p.consoleErrors)
  s.check(`${label}: no failed request`, failed.length === 0, failed)
  return p
}

// ── fixtures ─────────────────────────────────────────────────────────

/** Removes a temp folder, retrying while Windows still holds it (a server that just exited). */
async function removeDir(dir) {
  for (let i = 0; ; i++) {
    try {
      await rm(dir, { recursive: true, force: true })
      return
    } catch (e) {
      if (i >= 20) throw e
      await new Promise((r) => setTimeout(r, 250))
    }
  }
}

/** A temp copy of a round-trip app with the fixture foundation added through `pwf add`. */
async function prepare(s, app) {
  const dir = await mkdtemp(join(tmpdir(), `pwf-e2e-${app}-`))
  const root = join(dir, 'app')
  await cp(join(ROUNDTRIP, app, 'input'), root, { recursive: true })
  await cp(join(ROUNDTRIP, '_foundation', 'input'), join(dir, 'foundation'), { recursive: true })
  const expected = JSON.parse(await readFile(join(ROUNDTRIP, app, 'expected.json'), 'utf8'))
  const added = await pwf(['add', join(dir, 'foundation')], root)
  s.check('pwf add exits 0', added.code === 0, added.err)
  const pin = JSON.parse(await readFile(join(root, 'pwpack.json'), 'utf8')).packs?.[0]?.hash
  s.check('the pin pwf add writes equals the spec pin', pin === expected.pins?.[0]?.hash, { pin, expected: expected.pins?.[0]?.hash })
  return { dir, root, cleanup: () => removeDir(dir) }
}

async function validateAndBuild(s, root) {
  const v = await timed(s, 'validateMs', () => pwf(['validate'], root))
  s.check('pwf validate exits 0', v.code === 0, v.out + v.err)
  const b = await timed(s, 'buildMs', () => pwf(['build'], root))
  s.check('pwf build exits 0', b.code === 0, b.out + b.err)
  return b.code === 0
}

/** The policy a built app carries: `_headers` (served by `pwf run` as a header), the shell's meta, publish.json. */
async function checkPolicy(s, root, url) {
  const publish = JSON.parse(await readFile(join(root, '.pwf', 'out', 'publish.json'), 'utf8'))
  const policy = publish.csp?.policy
  s.check('publish.json carries the policy', typeof policy === 'string' && policy.startsWith("default-src 'none'"), publish.csp)
  const res = await fetch(url)
  s.check('pwf run serves the policy as a header', res.headers.get('content-security-policy') === policy, res.headers.get('content-security-policy'))
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(await res.text())?.[1]
  s.check('the shell carries the policy as a meta (without frame-ancestors)', meta === policy?.replace("; frame-ancestors 'none'", ''), meta)
  s.policy = policy
  return policy
}

/** Serves the built folder with `pwf run --port 0`, opens it and waits for `ready`. */
async function openBuilt(s, browser, root, ready, timing = 'renderMs') {
  const server = await pwfServe(['run', join('.pwf', 'out'), '--port', '0'], root, /Serving \S+ at (http\S+)/)
  try {
    await checkPolicy(s, root, server.url)
    const page = await browser.newPage()
    s.page = page
    await timed(s, timing, async () => {
      await page.goto(server.url)
      await page.waitFor(ready)
    })
    return { server, page }
  } catch (e) {
    await server.stop()
    throw e
  }
}

// ── scenarios ────────────────────────────────────────────────────────

async function l1(browser, s) {
  s.rename('l1-static (pwf run)')
  const app = await prepare(s, 'l1-static')
  try {
    if (!(await validateAndBuild(s, app.root))) return
    const { server, page } = await openBuilt(s, browser, app.root, textOf('[data-block-id="headline"]'))
    try {
      s.check('home: headline', (await page.evaluate(textOf('[data-block-id="headline"]'))) === 'A small studio that makes small things.')
      s.check('home: lede', (await page.evaluate(textOf('[data-block-id="lede"]'))) === 'Furniture, lamps and the odd clock.')
      s.check('home: the section wraps both', (await page.evaluate('document.querySelectorAll(\'[data-block-id="hero"] [data-block-type="text"]\').length')) === 2)
      const title = await page.evaluate('document.title')
      s.check('title carries the plan title', typeof title === 'string' && title.includes('Static two-page site'), title)
      const token = await page.evaluate(
        'getComputedStyle(document.querySelector(\'[data-block-id="headline"]\')).getPropertyValue("--pw-color-text").trim()'
      )
      s.check('theme tokens reach the blocks (--pw-color-text)', Boolean(token), token)
      await checkClean(s, page, 'home')
      await timed(s, 'routeMs', async () => {
        await page.evaluate('location.hash = "#/about"')
        await page.waitFor(textOf('[data-block-id="body"]'))
      })
      s.check('about: body', (await page.evaluate(textOf('[data-block-id="body"]'))) === 'Two people, one workbench, since 2019.')
      s.check('about: home content gone', (await page.evaluate(textOf('[data-block-id="headline"]'))) === null)
      await checkClean(s, page, 'about')
    } finally {
      await server.stop()
    }
  } finally {
    await app.cleanup()
  }
  return
}

async function l2(browser, s) {
  s.rename('l2-custom-block (pwf run)')
  const app = await prepare(s, 'l2-custom-block')
  try {
    if (!(await validateAndBuild(s, app.root))) return
    const manifest = JSON.parse(await readFile(join(app.root, '.pwf', 'out', 'blocks', 'manifest.json'), 'utf8'))
    s.check('the app block is in blocks/manifest.json', manifest.some((b) => b.blockType === 'greeting'), manifest.map((b) => b.blockType))
    const { server, page } = await openBuilt(s, browser, app.root, textOf('[data-block-id="greeting"]'))
    try {
      s.check('greeting renders from the app block', (await page.evaluate(textOf('[data-block-id="greeting"]'))) === 'Hello, visitor!')
      const greeting = await page.evaluate(
        '(() => { const e = document.querySelector(\'[data-block-type="greeting"]\'); return { weight: getComputedStyle(e).fontWeight, html: e.outerHTML } })()'
      )
      s.check('greeting honours emphasis', greeting.weight === '600', greeting)
      s.check('note renders from the foundation', (await page.evaluate(textOf('[data-block-id="note"]'))) === 'The greeting above is this app’s own block.')
      await checkClean(s, page, 'home')
    } finally {
      await server.stop()
    }
  } finally {
    await app.cleanup()
  }
  return
}

const SEEDED = '["Medlar","Pear","Quince"]'
const sortedRows = async (page) => JSON.stringify((await page.evaluate(ROWS)).slice().sort())

async function l3(browser, s) {
  s.rename('l3-data (pwf run)')
  const app = await prepare(s, 'l3-data')
  try {
    if (!(await validateAndBuild(s, app.root))) return
    const { server, page } = await openBuilt(s, browser, app.root, 'document.querySelector(\'[data-block-id="list"]\')')
    try {
      s.check('products page renders its section', await page.evaluate('Boolean(document.querySelector(\'[data-block-id="list"]\'))'))
      // No host behind a static folder: the sign-in door has no addresses, so no wall.
      s.check('no sign-in wall without a host', !(await page.evaluate('Boolean(document.getElementById("pwapp-sign-in-gate"))')))
      await page.idle()
      // L3 declares an identity, so the runner asks for auth.json; a static
      // build has no host to write the door, so the file is absent.
      await checkClean(s, page, 'products', (r) => /^404 \S+\/pwpack\/auth\.json$/.test(r))
      // The products source is an `entity` source. A static folder has no host
      // to answer it (and seed records are a development convention, not part
      // of the build), so the repeater draws nothing and nothing is requested.
      s.check('static: no records request (no host behind a static folder)', !page.requests.some((r) => /\/records\/Product/.test(r.url)))
      const rows = await page.evaluate(ROWS)
      s.check('static: the repeater draws no rows and no unexpanded template', rows.length === 0, rows)
      s.note(`static: ${rows.length} product rows (an entity source needs a host; pwf dev provides one)`)
    } finally {
      await server.stop()
    }
  } finally {
    await app.cleanup()
  }
  return
}

async function l3Dev(browser, s) {
  s.rename('l3-data as written (pwf dev, local host)')
  const app = await prepare(s, 'l3-data')
  try {
    const v = await pwf(['validate'], app.root)
    s.check('pwf validate exits 0', v.code === 0, v.out + v.err)
    const server = await pwfServe(['dev', '--port', '0'], app.root, /pwf dev: serving .* at (http\S+)/)
    try {
      s.check('the local host is mounted', /local host mounted at /.test(server.output()), server.output())
      const auth = await (await fetch(`${server.url}pwpack/auth.json`)).json()
      s.check('envelope auth.json points at the host', auth.loginUrl === `${server.url}_host/login`, auth)
      const project = await (await fetch(`${server.url}pwpack/project.json`)).json()
      s.check('project.json carries the declared identity', JSON.stringify(project.identity) === '{"required":false,"topology":"app","methods":["password"]}', project.identity)
      const seeded = await (await fetch(`${server.url}_host/records/Product`)).json()
      s.check('the host seeds Product from app/data', seeded.data?.length === 3, seeded)
      const page = await browser.newPage()
      s.page = page
      await timed(s, 'renderMs', async () => {
        await page.goto(server.url)
        await page.waitFor('document.querySelector(\'[data-block-id="list"]\')')
      })
      await page.waitFor(`${ROWS}.length === 3`, { what: 'the three seeded rows' })
      s.check('dev: the repeater draws the seeded rows', (await sortedRows(page)) === SEEDED, await page.evaluate(ROWS))
      s.check('dev: rows are per-item clones of the template (name--<i>)', (await page.evaluate(`document.querySelectorAll('[data-block-type="text"][data-block-id^="name--"]').length`)) === 3)
      s.check('dev: the entity source was read from the host', page.requests.some((r) => r.method === 'GET' && r.url.startsWith(`${server.url}_host/records/Product`)))
      await page.idle()
      await checkClean(s, page, 'products')
    } finally {
      await server.stop()
    }
  } finally {
    await app.cleanup()
  }
  return
}

// L3 extended with what a browser loop needs and the spec app does not carry:
// sign-in REQUIRED (so there is gated content), the products source as an
// an app block with a form bound to the products source through
// `platform/entities`. The source and the repeater are the spec app's own.
const L3_LOOP = {
  'app/definitions/auth.json': { required: true, topology: 'app', methods: ['password'] },
  'app/surfaces/products.receipt.json': {
    title: 'Products',
    blocks: [
      {
        id: 'list',
        type: 'section',
        props: { gap: 16 },
        children: [
          { id: 'add', type: 'product-form', props: {} },
          {
            id: 'rows',
            type: 'repeater',
            repeat: '{{Product}}',
            props: {},
            children: [{ id: 'name', type: 'text', props: { content: '{{item.name}}' } }],
          },
        ],
      },
    ],
    capabilities: [
      { capability: 'platform/persistence', config: { dataSources: [{ id: 'Product', kind: 'entity', entityType: 'Product' }], initialState: {} } },
      { capability: 'platform/entities', config: { formBindings: [{ formId: 'add', sourceId: 'Product' }] } },
    ],
  },
  'atoms/blocks/custom/product-form/manifest.json': {
    id: 'custom.product-form',
    kind: 'block',
    version: '1.0.0',
    category: 'custom',
    name: 'product-form',
    state: 'stable',
    knowledge: { purpose: 'Adds a product', useCases: [], composesWith: [], antiPatterns: [] },
    definition: { props: [], defaultProps: {}, canHaveChildren: false, traits: [] },
  },
  'atoms/blocks/custom/product-form/component.tsx': `import * as React from 'react'
import { useSurfaceEvents, useSurfaceId } from '@pwfabric/runtime'

/** A two-field form that submits through the surface bus, as the foundation's form block does. */
export const ProductFormBlock = ({ block }: { block: { id: string } }) => {
  const { emit } = useSurfaceEvents()
  const surfaceId = useSurfaceId()
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const values = { name: String(data.get('name') ?? ''), price: Number(data.get('price') ?? 0) }
    emit({ type: 'form:submit', surfaceId, blockId: block.id, payload: { values, formId: block.id, timestamp: Date.now() } })
    e.currentTarget.reset()
  }
  return (
    <form data-block-id={block.id} data-block-type="product-form" onSubmit={onSubmit}>
      <input name="name" aria-label="Name" required />
      <input name="price" type="number" step="any" aria-label="Price" />
      <button type="submit">Add product</button>
    </form>
  )
}
`,
}


async function l3Loop(browser, s) {
  s.rename('l3-data sign-in and data loop (pwf dev, local host)')
  const app = await prepare(s, 'l3-data')
  try {
    for (const [path, value] of Object.entries(L3_LOOP)) {
      const abs = join(app.root, ...path.split('/'))
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`)
    }
    const v = await pwf(['validate'], app.root)
    s.check('pwf validate exits 0', v.code === 0, v.out + v.err)
    const server = await pwfServe(['dev', '--port', '0'], app.root, /pwf dev: serving .* at (http\S+)/)
    const page = await browser.newPage()
    s.page = page
    try {
      // 1. Gated: the wall, and none of the page behind it.
      await timed(s, 'renderMs', async () => {
        await page.goto(server.url)
        await page.waitFor(GATE)
      })
      s.check('signed out: the sign-in wall shows', await page.evaluate(GATE))
      s.check('signed out: no product row in the page', (await page.evaluate(ROWS)).length === 0)
      const receipt = await fetch(`${server.url}_host/surfaces/products.receipt.json`)
      s.check('signed out: the host refuses the receipt (401)', receipt.status === 401, receipt.status)

      // 2. Sign in as the development user through the password form.
      await timed(s, 'signInMs', async () => {
        await page.evaluate(`(() => {
          const gate = document.getElementById('pwapp-sign-in-gate')
          gate.querySelector('input[name="email"]').value = 'dev@localhost'
          gate.querySelector('input[name="password"]').value = 'anything'
          gate.querySelector('form').requestSubmit()
        })()`)
        await page.waitFor(`!${GATE} && ${ROWS}.includes('Pear')`, { what: 'the wall to lift and the seeded rows' })
      })
      s.check('signed in: the seeded rows are listed', (await sortedRows(page)) === SEEDED, await page.evaluate(ROWS))
      const stored = await page.evaluate('Object.keys(sessionStorage).filter((k) => k.startsWith("pwapp_session:"))')
      s.check('signed in: the session is kept for the tab', stored.length === 1, stored)
      const label = await page.evaluate('document.querySelector("[data-session-label]")?.textContent ?? null')
      s.check('signed in: the account pill names the user', typeof label === 'string' && /Developer|dev@localhost/.test(label), label)

      // 3. Create a record through the page's form.
      await timed(s, 'createMs', async () => {
        await page.evaluate(`(() => {
          const form = document.querySelector('form[data-block-id="add"]')
          form.querySelector('input[name="name"]').value = 'Fig'
          form.querySelector('input[name="price"]').value = '3'
          form.requestSubmit()
        })()`)
        await page.waitFor(`${ROWS}.includes('Fig')`, { what: 'the new row' })
      })
      s.check('created: the new record is listed', (await page.evaluate(ROWS)).includes('Fig'))
      const post = page.requests.find((r) => r.method === 'POST' && r.url === `${server.url}_host/records/Product`)
      s.check('created: POST <base>/records/Product was sent', Boolean(post))
      s.check(
        'created: the write carries the session',
        Boolean(post && Object.entries(post.headers).some(([k, v]) => (k.toLowerCase() === 'authorization' && /^Bearer /.test(v)) || k.toLowerCase() === 'x-app-session'))
      )
      const stored2 = await (await fetch(`${server.url}_host/records/Product`, { headers: { authorization: `Bearer ${await page.evaluate('JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find((k) => k.startsWith("pwapp_session:")))).token')}` } })).json()
      s.check('created: the host holds it', stored2.data?.some((r) => r.name === 'Fig' && r.price === 3), stored2.data)
      await checkClean(s, page, 'signed in')

      // 4. Reload: still signed in, still listed.
      await timed(s, 'reloadMs', async () => {
        await page.reload()
        await page.waitFor(`${ROWS}.includes('Fig')`, { what: 'the row after reload' })
      })
      s.check('reloaded: no wall', !(await page.evaluate(GATE)))
      s.check('reloaded: the new record is still listed', (await page.evaluate(ROWS)).includes('Fig'))
      s.check('reloaded: no new sign-in was needed', !page.requests.slice(-50).some((r) => r.url.endsWith('/_host/login') && r.method === 'POST' && page.requests.indexOf(r) > page.requests.indexOf(post)))
      await checkClean(s, page, 'reloaded')

      // 5. Sign out: the wall comes back and the content goes.
      await timed(s, 'signOutMs', async () => {
        await page.evaluate('document.querySelector("[data-session-signout]").click()')
        await page.waitFor(`${GATE} && ${ROWS}.length === 0`, { what: 'the wall back and the rows gone' })
      })
      s.check('signed out: the wall is back', await page.evaluate(GATE))
      s.check('signed out: gated content is gone from the DOM', (await page.evaluate(ROWS)).length === 0)
      s.check('signed out: the session is forgotten', (await page.evaluate('Object.keys(sessionStorage).filter((k) => k.startsWith("pwapp_session:")).length')) === 0)
      s.check('signed out: POST <base>/logout was sent', page.requests.some((r) => r.method === 'POST' && r.url === `${server.url}_host/logout`))
      await checkClean(s, page, 'signed out')
    } finally {
      await server.stop()
    }
  } finally {
    await app.cleanup()
  }
  return
}

// L2 with one more app block that tries to reach an origin the app never
// declared. The policy must stop it, and stopping it must be the only
// violation on the page.
const PROBE_BLOCK = `import * as React from 'react'

/** Tries an undeclared origin and says what happened. */
export const ProbeBlock = ({ block }: { block: { id: string } }) => {
  const [result, setResult] = React.useState('pending')
  React.useEffect(() => {
    fetch('https://not-declared.example/probe')
      .then(() => setResult('reached'))
      .catch((e: unknown) => setResult(\`blocked: \${e instanceof Error ? e.name : String(e)}\`))
  }, [])
  return <p data-block-id={block.id} data-block-type="probe">{result}</p>
}
`

async function cspProbe(browser, s) {
  s.rename('csp probe: an undeclared origin is blocked (pwf run)')
  const app = await prepare(s, 'l2-custom-block')
  try {
    const receiptPath = join(app.root, 'app', 'surfaces', 'home.receipt.json')
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    receipt.blocks[0].children.push({ id: 'probe', type: 'probe', props: {} })
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
    const dir = join(app.root, 'atoms', 'blocks', 'custom', 'probe')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'component.tsx'), PROBE_BLOCK)
    await writeFile(
      join(dir, 'manifest.json'),
      `${JSON.stringify({ id: 'custom.probe', kind: 'block', version: '1.0.0', category: 'custom', name: 'probe', state: 'stable', knowledge: { purpose: 'CSP probe', useCases: [], composesWith: [], antiPatterns: [] }, definition: { props: [], defaultProps: {}, canHaveChildren: false, traits: [] } }, null, 2)}\n`
    )
    if (!(await validateAndBuild(s, app.root))) return
    const { server, page } = await openBuilt(s, browser, app.root, `/^(blocked|reached)/.test((${textOf('[data-block-id="probe"]')}) ?? '')`)
    try {
      s.check('the policy lists no not-declared.example', !s.policy.includes('not-declared.example'), s.policy)
      const result = await page.evaluate(textOf('[data-block-id="probe"]'))
      s.check('the fetch to the undeclared origin failed', typeof result === 'string' && result.startsWith('blocked'), result)
      s.check('the greeting still renders', (await page.evaluate(textOf('[data-block-id="greeting"]'))) === 'Hello, visitor!')
      const csp = await page.takeCsp()
      const events = csp.page
      // One report per enforced policy: `pwf run` serves the header and the
      // shell carries the meta, and the browser enforces (and reports) both.
      s.check(
        'every violation is the probe: connect-src, not-declared.example',
        events.length >= 1 && events.every((e) => e.directive === 'connect-src' && /not-declared\.example/.test(e.blocked)),
        events
      )
      s.check('the browser log names the blocked request', csp.log.some((l) => /not-declared\.example/.test(l) && /connect-src/.test(l)), csp.log)
      s.csp.checked++
      s.csp.violations += events.length
      s.note(`probe: ${result}; ${events.length} violation report(s), e.g. ${JSON.stringify(events[0] ?? null)}`)
      const p = page.takeProblems()
      const other = p.consoleErrors.filter((e) => !/not-declared\.example|Content Security Policy/.test(e))
      s.check('no other console error', other.length === 0 && p.exceptions.length === 0, { other, exceptions: p.exceptions })
    } finally {
      await server.stop()
    }
  } finally {
    await app.cleanup()
  }
  return
}

async function realFoundation(browser, s) {
  s.rename(`real foundation (pwf create + pwf dev): ${foundationDir}`)
  const dir = await mkdtemp(join(tmpdir(), 'pwf-e2e-foundation-'))
  try {
    const c = await timed(s, 'createMs', () => pwf(['create', 'demo', '--foundation', foundationDir], dir))
    s.check('pwf create exits 0', c.code === 0, c.out + c.err)
    const root = join(dir, 'demo')
    if (c.code !== 0) return
    const v = await timed(s, 'validateMs', () => pwf(['validate'], root))
    s.check('pwf validate exits 0', v.code === 0, v.out + v.err)
    const receipt = JSON.parse(await readFile(join(root, 'app', 'surfaces', 'home.receipt.json'), 'utf8'))
    const blocks = receipt.blocks
    const server = await pwfServe(['dev', '--port', '0'], root, /pwf dev: serving .* at (http\S+)/)
    try {
      const built = /built in (\d+) ms[^\n]*/.exec(server.output())
      if (built) s.note(`dev: ${built[0]}`)
      const page = await browser.newPage()
      s.page = page
      const texts = blocks.map((b) => Object.values(b.props).find((v) => typeof v === 'string' && v !== '/' && v !== 'h1'))
      await timed(s, 'devRenderMs', async () => {
        await page.goto(server.url)
        await page.waitFor(`document.body.innerText.includes(${JSON.stringify(texts[0])})`, { timeoutMs: 60_000 })
      })
      const body = await page.evaluate('document.body.innerText')
      for (const [i, b] of blocks.entries()) {
        s.check(`home: ${b.type} "${texts[i]}" renders`, typeof texts[i] === 'string' && body.includes(texts[i]), body.slice(0, 300))
      }
      const typed = await page.evaluate('[...new Set([...document.querySelectorAll("[data-block-type]")].map((e) => e.getAttribute("data-block-type")))]')
      s.note(`rendered block types: ${typed.join(', ') || '(none marked with data-block-type)'}`)
      await checkClean(s, page, 'home')
    } finally {
      await server.stop()
    }
    const b = await timed(s, 'buildMs', () => pwf(['build'], root))
    s.check('pwf build exits 0', b.code === 0, b.out + b.err)
    if (b.code === 0) {
      const first = (receipt.blocks[0]?.props?.text ?? receipt.blocks[0]?.props?.content ?? '').toString()
      const browserStatic = await openBuilt(s, browser, root, `document.body.innerText.includes(${JSON.stringify(first)})`, 'staticRenderMs')
      try {
        await checkClean(s, browserStatic.page, 'home (pwf run)')
      } finally {
        await browserStatic.server.stop()
      }
    }
  } finally {
    await removeDir(dir).catch(() => undefined)
  }
  return
}

/** What a page shows and what went wrong on it, for a failure report. */
async function describePage(page) {
  return {
    url: await page.evaluate('location.href'),
    text: (await page.evaluate('document.body.innerText')).slice(0, 400),
    lastRequests: page.requests.slice(-8).map((r) => `${r.method} ${r.url}`),
    ...page.takeProblems(),
  }
}

// ── main ─────────────────────────────────────────────────────────────

const SCENARIOS = { l1, l2, l3, 'l3-dev': l3Dev, 'l3-loop': l3Loop, 'csp-probe': cspProbe, foundation: realFoundation }
const browser = await launchChrome({ chrome: chromePath })
log(`chrome: ${browser.version} (${chromePath})`)
const results = []
try {
  for (const [name, run] of Object.entries(SCENARIOS)) {
    if (!only.has(name)) continue
    if (name === 'foundation' && !foundationDir) continue
    const t0 = performance.now()
    const s = new Scenario(name)
    try {
      await run(browser, s)
    } catch (e) {
      s.check('the scenario ran to the end', false, e instanceof Error ? e.message : String(e))
      if (s.page) s.note(`page when it stopped: ${JSON.stringify(await describePage(s.page).catch((x) => String(x)))}`)
    }
    const result = s.result()
    result.timings.totalMs = Math.round(performance.now() - t0)
    results.push(result)
    log(
      `${result.ok ? 'PASS' : 'FAIL'} ${result.name}: ${result.assertions.passed} passed, ${result.assertions.failed} failed; ${Object.entries(result.timings)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')}`
    )
    log(`  csp: ${result.csp.violations} violations over ${result.csp.checked} checks`)
    for (const f of result.failures) log(`  ✗ ${f}`)
    for (const f of result.findings) log(`  • ${f}`)
  }
} finally {
  await browser.close()
}
finish({ chrome: browser.version, results }, results.every((r) => r.ok) ? 0 : 1)
