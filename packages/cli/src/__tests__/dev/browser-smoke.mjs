// Browser smoke: boots an assembled pwapp's real module graph in a jsdom
// document and prints what rendered as one JSON line.
//
//   node browser-smoke.mjs <app url> [--no-seed] [--expect <selector>]
//
// --no-seed leaves out the shell's `assets/seed.js`, so the page is what a
// host that runs only the renderer and the runner gives a block (a published
// PhiWebs app is one). --expect waits for one more element and reports its text.
//
// Runs as a plain Node process (the test runner's module sandbox has no
// dynamic import for evaluated code). jsdom has no import maps and Node cannot
// import `blob:` URLs, so the two things a browser does natively are done by
// hand: bare specifiers resolve through the page's own import map to the
// served shim files, and the block loader's verified `blob:` module is handed
// over as a `data:` URL with the same rewrite. Everything else — the renderer,
// the runner, the integrity check, the fetches, the render — is shipped code.
import { JSDOM } from 'jsdom'

const base = process.argv[2]
const flags = process.argv.slice(3)
const noSeed = flags.includes('--no-seed')
const expectSelector = flags.includes('--expect') ? flags[flags.indexOf('--expect') + 1] : null
const nodeFetch = globalThis.fetch
const get = async (p) => (await nodeFetch(new URL(p, base))).text()
const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const errors = []

const html = await get('/')
const map = JSON.parse(/<script type="importmap">(.*?)<\/script>/s.exec(html)?.[1] ?? '{}')
const shimUrls = new Map()
for (const [spec, target] of Object.entries(map.imports)) shimUrls.set(spec, dataUrl(await get(target)))
const link = (code) =>
  code.replace(/(from\s*|import\s*\(?\s*)(["'])([^"']+)\2/g, (whole, pre, q, spec) =>
    shimUrls.has(spec) ? `${pre}${q}${shimUrls.get(spec)}${q}` : whole
  )

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: base,
  pretendToBeVisual: true,
})
for (const key of Object.getOwnPropertyNames(dom.window)) {
  if (key in globalThis || key.startsWith('_')) continue
  globalThis[key] = dom.window[key]
}
globalThis.window = dom.window
// jsdom does not lay out, so it does not scroll.
dom.window.scrollTo = () => undefined
dom.window.matchMedia = (query) => ({
  matches: false, media: query, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
})
for (const name of ['ResizeObserver', 'IntersectionObserver']) {
  dom.window[name] ??= class { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
}
globalThis.matchMedia = dom.window.matchMedia
for (const fn of ['addEventListener', 'removeEventListener', 'dispatchEvent']) globalThis[fn] = dom.window[fn].bind(dom.window)

globalThis.fetch = (input, init) => nodeFetch(typeof input === 'string' ? new URL(input, base) : input, init)
const blobs = new WeakMap()
const RealBlob = globalThis.Blob
globalThis.Blob = class extends RealBlob {
  constructor(parts = [], opts) {
    super(parts, opts)
    const first = parts[0]
    if (first instanceof ArrayBuffer) blobs.set(this, new Uint8Array(first))
    else if (ArrayBuffer.isView(first)) blobs.set(this, new Uint8Array(first.buffer, first.byteOffset, first.byteLength))
  }
}
URL.createObjectURL = (obj) => dataUrl(link(new TextDecoder().decode(blobs.get(obj) ?? new Uint8Array())))
URL.revokeObjectURL = () => undefined
console.error = (...a) => errors.push(a.map(String).join(' ').slice(0, 400))
console.warn = () => undefined
console.info = () => undefined

// The shell, in order: renderer, the seeding file, then the runner (boot.js calls runApp as below).
;(0, eval)(await get('/assets/embed.js'))
if (!noSeed) (0, eval)(await get('/assets/seed.js'))
dom.window.PWFabric = globalThis.PWFabric
const seeded = [
  '__pwfabric_react',
  '__pwfabric_jsx_runtime',
  '__pwfabric_zod',
  '__pwfabric_runtime',
  '__pwfabric_contracts',
  '__pwfabric_react_dom',
  '__pwfabric_core',
  '__pwfabric_sdk',
].filter((k) => globalThis[k])
// Values, not just objects: a block that calls defineBlock() or reads a core helper gets a function.
const values = {
  defineBlock: typeof globalThis.__pwfabric_sdk?.defineBlock,
  coreExports: Object.keys(globalThis.__pwfabric_core ?? {}).length,
}
const runner = await import(dataUrl(link(await get('/assets/runner.js'))))
await runner.runApp({
  source: new URL('pwpack', base).href,
  blocks: new URL('blocks/', base).href,
  engines: new URL('engines', base).href,
  router: 'hash',
})
const deadline = Date.now() + 20_000
const rendered = () => document.querySelector('[data-k="title"]') && (!expectSelector || document.querySelector(expectSelector))
while (Date.now() < deadline && !rendered()) await new Promise((r) => setTimeout(r, 100))
process.stdout.write(
  JSON.stringify({
    seeded,
    values,
    renderer: typeof globalThis.PWFabric?.render,
    title: document.title,
    heading: document.querySelector('[data-k="title"]')?.textContent ?? null,
    stack: Boolean(document.querySelector('[data-k="stack"]')),
    expected: expectSelector ? (document.querySelector(expectSelector)?.textContent ?? null) : undefined,
    primary: document.querySelector('[data-k="title"]')?.getAttribute('style') ?? null,
    errors,
  }) + '\n'
)
process.exit(0)
