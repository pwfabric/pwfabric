import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 60_000 })
import { assemblePwapp, atomsLine, blockNames } from '../../dev/assemble.js'
import { createCompileCache } from '../../dev/compile.js'
import { loadSources, packCacheRel, type PackMemo } from '../../dev/sources.js'
import { makeApp, PACK_REL, parse, text } from './helpers.js'

let cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()))
  cleanups = []
})
async function app(withPack = true): Promise<string> {
  const a = await makeApp({ withPack })
  cleanups.push(a.cleanup)
  return a.root
}
const codes = (r: { diagnostics: readonly { code: string }[] }): string[] => r.diagnostics.map((d) => d.code)
/** The served name of a content-hashed runtime file: `assets/runner.<8 hex>.js`. */
const asset = (r: { files: Map<string, Uint8Array> }, name: 'runner' | 'embed' | 'boot' | 'theme'): string => {
  const ext = name === 'theme' ? 'css' : 'js'
  const hit = [...r.files.keys()].find((k) => new RegExp(`^assets/${name}\\.[0-9a-f]{8}\\.${ext}$`).test(k))
  if (!hit) throw new Error(`no assets/${name}.<hash>.${ext}`)
  return hit
}

describe('assemblePwapp', () => {
  it('lays out a static pwapp from the app and its pinned pack', async () => {
    const root = await app()
    const r = await assemblePwapp(root, { publishedAt: '2026-10-06T00:00:00.000Z' })
    expect(r.ok, codes(r).join()).toBe(true)
    expect(r.stats).toMatchObject({ pages: 1, blocks: 2, engines: 2, atoms: 5, compiled: 4, failed: 0 })
    const paths = [...r.files.keys()]
    for (const p of [
      'index.html',
      asset(r, 'runner'),
      asset(r, 'embed'),
      asset(r, 'theme'),
      asset(r, 'boot'),
      'robots.txt',
      'shims/react.mjs',
      'blocks/manifest.json',
      'engines/manifest.json',
      'pwpack/project.json',
      'pwpack/surfaces/home.receipt.json',
      'pwpack/navigation.json',
      'pwpack/appearance.json',
      'pwpack/connections.json',
      'publish.json',
    ]) {
      expect(paths).toContain(p)
    }
    expect(text(r.files.get('index.html'))).not.toContain('/_pwf/events')
    // No source map is served to a visitor, and no seed script is needed.
    expect(paths.filter((p) => p.endsWith('.map'))).toEqual([])
    expect(paths).not.toContain('assets/seed.js')
    expect(text(r.files.get('robots.txt'))).toBe('User-agent: *\nAllow: /\n')

    const blocks = parse(r.files.get('blocks/manifest.json')) as { blockType: string; moduleUrl: string; integrity: string }[]
    expect(blocks.map((b) => b.blockType)).toEqual(['stack', 'title'])
    for (const b of blocks) {
      const bytes = r.files.get(b.moduleUrl) as Uint8Array
      const { createHash } = await import('node:crypto')
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(b.integrity)
    }
    expect(parse(r.files.get('engines/manifest.json'))).toEqual([
      expect.objectContaining({ connection: 'echo', atomId: 'Echo', kind: 'connector', moduleUrl: expect.stringMatching(/^engines\/Echo\.[0-9a-f]{8}\.mjs$/) }),
      { connection: 'still', atomId: 'Still', kind: 'connector', engine: { version: 1 } },
    ])
    expect(parse(r.files.get('pwpack/project.json'))).toMatchObject({ id: '@pwpack/k/demo', title: 'K Demo', entrySurfaceId: 'home', surfaceOrder: ['home'] })
    expect(parse(r.files.get('pwpack/navigation.json'))).toEqual({ navbar: { links: [{ label: 'Home', href: '/' }] } })
    expect(parse(r.files.get('pwpack/appearance.json'))).toEqual({
      // The webfont's metric-matched stand-in is named right after it (pwapp-format §2.3).
      theme: { colors: { primary: '#7c2d12', background: '#fffbeb', text: '#1c1917', accent: '#b45309' }, typography: { fontFamily: 'Inter, "Inter Fallback", system-ui, sans-serif' } },
    })
    expect(text(r.files.get('pwpack/connections.json'))).not.toContain('do-not-ship')
    expect(codes(r)).toContain('CREDENTIAL_DROPPED')
    expect(text(r.files.get(asset(r, 'theme')))).toContain('--pw-color-primary: #7c2d12')
    expect(text(r.files.get(asset(r, 'theme')))).toContain('font-family: "Inter Fallback";')
    const publish = parse(r.files.get('publish.json')) as Record<string, unknown>
    expect(publish).toMatchObject({
      formatVersion: '1.0',
      app: { id: '@pwpack/k/demo', version: '0.1.0' },
      liveVersion: '0.1.0',
      publishedAt: '2026-10-06T00:00:00.000Z',
      packs: [{ id: '@pwpack/k/kit', version: '1.0.0' }],
    })
    expect((publish['atoms'] as { id: string; module?: string }[]).map((a) => [a.id, Boolean(a.module)])).toEqual([
      ['layout.stack', true],
      ['text.title', true],
      ['Echo', true],
      ['Still', false],
    ])

    // One policy, three places: the shell's meta (no frame-ancestors), `_headers`, publish.json.
    const csp = publish['csp'] as { policy: string; unresolved?: { source: string }[] }
    expect(csp.policy).toMatch(/^default-src 'none'; script-src 'self' blob: 'sha256-[A-Za-z0-9+/]+=*' 'sha256-[A-Za-z0-9+/]+=*' 'sha256-[A-Za-z0-9+/]+=*'; style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com;/)
    expect(csp.policy).toContain("font-src 'self' https://fonts.gstatic.com")
    expect(csp.policy).toContain("frame-ancestors 'none'")
    // The compiled engine's reach is not declared, so it is listed, not guessed.
    expect(csp.unresolved?.map((u) => u.source)).toEqual(['engine:Echo'])
    expect(text(r.files.get('_headers')).startsWith(`/*\n  Content-Security-Policy: ${csp.policy}\n`)).toBe(true)
    expect(text(r.files.get('_headers'))).toContain('/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n')
    const html = text(r.files.get('index.html'))
    const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)" \/>/.exec(html)?.[1]
    expect(meta).toBe(csp.policy.replace(/; frame-ancestors 'none'/, ''))
    const boot = text(r.files.get(asset(r, 'boot')))
    expect(boot).toContain('runApp(')
    expect(boot).toContain(`from "./${asset(r, 'runner').slice('assets/'.length)}"`)
    expect(boot).toContain(`renderer: "./${asset(r, 'embed')}"`)
    // The shell names the hashed files and starts the renderer without holding the page.
    expect(html).toContain(`<script type="module" src="./${asset(r, 'boot')}"></script>`)
    expect(html).toContain(`<script async src="./${asset(r, 'embed')}"></script>`)
    // The theme is written into the head: the first paint waits on no stylesheet.
    expect(html).not.toContain('rel="stylesheet"')
    expect(html).toContain(`<style>${text(r.files.get(asset(r, 'theme')))}</style>`)
    // What each page needs is named once; the shell asks for the opened page's (page-hints.dom.test.ts).
    const hints = JSON.parse(html.match(/<script type="application\/json" id="pw-page-hints">(.*?)<\/script>/)?.[1] ?? '{}')
    const manifest = parse(r.files.get('blocks/manifest.json')) as { moduleUrl: string }[]
    expect(hints.pages.home).toEqual({
      receipt: 'pwpack/surfaces/home.receipt.json',
      modules: manifest.map((m) => m.moduleUrl).sort(),
      frame: 'pwpack/surfaces/home.html',
    })
    // …and which page this document holds, so its frame is not asked for again.
    expect(hints.page).toBe('home')
    expect(html).not.toMatch(/<script src=/)
    // A hashed name is the hash of the bytes.
    const { createHash } = await import('node:crypto')
    const runner = asset(r, 'runner')
    expect(runner).toContain(createHash('sha256').update(r.files.get(runner) as Uint8Array).digest('hex').slice(0, 8))
  })

  it('a page that names its own theme wears it: served receipt, page palette, webfonts, first frame (N-E3)', async () => {
    const root = await app()
    // A second theme, the app's own: a dark ground, a webfont, its own dark variant.
    const night = join(root, 'atoms', 'appearance', 'theme-night')
    await mkdir(night, { recursive: true })
    const sand = JSON.parse(await readFile(join(root, ...PACK_REL, 'atoms', 'appearance', 'theme-sand', 'manifest.json'), 'utf8')) as Record<string, unknown>
    await writeFile(
      join(night, 'manifest.json'),
      JSON.stringify({
        ...sand,
        id: 'theme-night',
        name: 'Night',
        theme: { colors: { primary: '#93c5fd', background: '#0b1020', text: '#e2e8f0' }, typography: { fontFamily: 'Nunito, sans-serif' } },
        darkTheme: { colors: { background: '#000000' } },
      })
    )
    const pwpackPath = join(root, 'pwpack.json')
    const pwpack = JSON.parse(await readFile(pwpackPath, 'utf8')) as { app: { surfaceOrder: string[] } }
    pwpack.app.surfaceOrder = ['home', 'night', 'same', 'lost']
    await writeFile(pwpackPath, JSON.stringify(pwpack))
    const home = JSON.parse(await readFile(join(root, 'app', 'surfaces', 'home.receipt.json'), 'utf8')) as Record<string, unknown>
    const page = async (key: string, appearance: unknown): Promise<void> =>
      writeFile(join(root, 'app', 'surfaces', `${key}.receipt.json`), JSON.stringify({ ...home, title: key, appearance }))
    await page('night', { use: 'theme-night' })
    await page('same', { use: 'theme-sand' })
    await page('lost', { use: 'theme-ocean' })

    const r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    const served = (key: string) => parse(r.files.get(`pwpack/surfaces/${key}.receipt.json`)) as Record<string, unknown>
    // Its theme's tokens and dark variant, resolved; its webfont's stand-in named.
    expect(served('night')['appearance']).toEqual({
      config: {
        theme: { colors: { primary: '#93c5fd', background: '#0b1020', text: '#e2e8f0' }, typography: { fontFamily: 'Nunito, "Nunito Fallback", sans-serif' } },
        darkTheme: { colors: { background: '#000000' } },
      },
    })
    // The app's own theme named again (or no theme): the page wears the app's, accent override included.
    expect(served('same')['appearance']).toBeUndefined()
    expect(served('home')['appearance']).toBeUndefined()
    // An unknown name: the diagnostic the app-level `use` gets, on the receipt; kept as written.
    const lost = r.diagnostics.find((d) => d.code === 'THEME_NOT_FOUND')
    expect(lost?.path).toBe('app/surfaces/lost.receipt.json')
    expect(served('lost')['appearance']).toEqual({ use: 'theme-ocean' })

    // The document's ground under <html data-pw-page="night">, light and dark; the app's stays first.
    const css = text(r.files.get(asset(r, 'theme')))
    expect(css.indexOf(':root, [data-pw-surface] {')).toBeLessThan(css.indexOf(':root[data-pw-page="night"] {'))
    expect(css).toMatch(/:root\[data-pw-page="night"\] \{[^}]*--pw-color-background: #0b1020;/)
    expect(css).toMatch(/:root\[data-pw-page="night"\]\[data-pw-theme="dark"\] \{[^}]*--pw-color-background: #000000;/)
    expect(css).not.toContain('data-pw-page="same"')
    expect(css).toContain('font-family: "Nunito Fallback";')
    expect(css).toContain('font-family: "Inter Fallback";')
    // One webfont stylesheet for both themes.
    const boot = text(r.files.get(asset(r, 'boot')))
    expect(boot).toMatch(/fonts\.googleapis\.com\/css2\?family=Inter[^"]*&family=Nunito/)
    // The page's first frame is painted in its theme, not the app's.
    const frame = text(r.files.get('pwpack/surfaces/night.html'))
    expect(frame).toContain('--pw-color-background:#0b1020')
    expect(frame).not.toContain('--pw-color-background:#fffbeb')
    expect(text(r.files.get('pwpack/surfaces/same.html'))).toContain('--pw-color-background:#fffbeb')
  })

  it('N-E5: the facets of one provider ship in ONE module, its shared code once, each connection naming its export', async () => {
    const root = await app()
    const pack = join(root, ...PACK_REL, 'atoms')
    // A vendor motor and two entity facets, all three importing one shared lib.
    const MARK = 'acme-shared-'.padEnd(3000, 'z')
    await mkdir(join(pack, 'providers', 'acme', 'entities'), { recursive: true })
    await writeFile(join(pack, 'lib', 'acme-shared.ts'), `export const MARK = '${MARK}'\nexport const table = (n: string) => ({ table: n, mark: MARK })\n`)
    await writeFile(
      join(pack, 'providers', 'acme', 'index.ts'),
      `import { MARK } from '../../lib/acme-shared'\nexport class AcmeEngine {\n  constructor(private t: unknown, private map: Record<string, unknown>) {}\n  async query() { return [MARK, ...Object.keys(this.map)] }\n}\n`
    )
    for (const [domain, entity] of [['orders', 'order'], ['users', 'user']] as const) {
      await writeFile(join(pack, 'providers', 'acme', 'entities', `${domain}.ts`), `import { table } from '../../../lib/acme-shared'\nexport const ${domain} = { ${entity}: table('${domain}') }\n`)
      await writeFile(
        join(pack, 'providers', 'acme', 'entities', `${domain}.knowledge.json`),
        JSON.stringify({ name: domain, kind: 'provider', connection: `acme-${domain}`, knowledge: { purpose: 'A fixture facet', useCases: ['A fixture page'], composesWith: [], antiPatterns: ['Anything real'] } })
      )
    }
    const connectionsPath = join(root, 'app', 'definitions', 'connections.json')
    const doc = JSON.parse(await readFile(connectionsPath, 'utf8')) as { connections: unknown[] }
    doc.connections.push({ name: 'orders', connector: 'acme-orders' }, { name: 'people', connector: 'acme-users' })
    await writeFile(connectionsPath, JSON.stringify(doc))

    const r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    const engines = parse(r.files.get('engines/manifest.json')) as { connection: string; atomId: string; moduleUrl?: string; integrity?: string; export?: string }[]
    const acme = engines.filter((e) => e.atomId.startsWith('acme.'))
    expect(acme.map((e) => [e.connection, e.atomId, e.export])).toEqual([
      ['orders', 'acme.orders', 'orders'],
      ['people', 'acme.users', 'users'],
    ])
    // One module for both, named for the vendor; the connector beside it keeps its own.
    expect(new Set(acme.map((e) => e.moduleUrl)).size).toBe(1)
    const moduleUrl = acme[0]?.moduleUrl as string
    expect(moduleUrl).toMatch(/^engines\/acme\.[0-9a-f]{8}\.mjs$/)
    expect(engines.find((e) => e.connection === 'echo')?.moduleUrl).toMatch(/^engines\/Echo\./)
    const files = [...r.files.keys()].filter((k) => k.startsWith('engines/') && k.endsWith('.mjs'))
    expect(files.filter((f) => f.includes('acme'))).toEqual([moduleUrl])
    // The shared code is in the served bytes once, not once per facet.
    const all = files.map((f) => text(r.files.get(f))).join('\n')
    expect(all.split(MARK).length - 1).toBe(1)
    // The integrity is the module's, and publish.json says the same.
    const { createHash } = await import('node:crypto')
    expect(acme[0]?.integrity).toBe(createHash('sha256').update(r.files.get(moduleUrl) as Uint8Array).digest('hex'))
    const published = (parse(r.files.get('publish.json')) as { atoms: { id: string; module?: string; integrity?: string }[] }).atoms
    expect(published.filter((a) => a.id.startsWith('acme.')).map((a) => [a.id, a.module, a.integrity])).toEqual([
      ['acme.orders', moduleUrl, acme[0]?.integrity],
      ['acme.users', moduleUrl, acme[0]?.integrity],
    ])
    // Each facet's export is its factory, over the shared motor.
    const dir = await mkdtemp(join(tmpdir(), 'pwf-engine-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const file = join(await realpath(dir), 'acme.mjs')
    await writeFile(file, r.files.get(moduleUrl) as Uint8Array)
    const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, (t: unknown, c: unknown) => { query(): Promise<string[]> }>
    expect(Object.keys(mod).sort()).toEqual(['orders', 'users'])
    expect(await (mod['users'] as (t: unknown, c: unknown) => { query(): Promise<string[]> })(async () => null, {}).query()).toEqual([MARK, 'user'])
  })

  it('N-E6: a served receipt carries no authoring knowledge; the source keeps it', async () => {
    const root = await app()
    const path = join(root, 'app', 'surfaces', 'home.receipt.json')
    const source = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    const knowledge = { purpose: 'The home page', patternsExercised: ['hero-split'] }
    await writeFile(path, JSON.stringify({ ...source, knowledge }))
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    const served = parse(r.files.get('pwpack/surfaces/home.receipt.json')) as Record<string, unknown>
    expect(served['knowledge']).toBeUndefined()
    expect(served['blocks']).toEqual(source['blocks'])
    expect(text(r.files.get('pwpack/surfaces/home.receipt.json'))).not.toContain('patternsExercised')
    expect((JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>)['knowledge']).toEqual(knowledge)
  })

  it('reads the app as its pack content: dotfiles and tooling are neither read nor reported', async () => {
    const root = await app()
    await writeFile(join(root, '.gitignore'), '.pwf/\n')
    await writeFile(join(root, '.editorconfig'), 'root = true\n')
    await writeFile(join(root, 'package.json'), '{}')
    const r = await assemblePwapp(root, { publishedAt: '2026-10-06T00:00:00.000Z' })
    expect(r.ok).toBe(true)
    expect(codes(r)).not.toContain('UNKNOWN_TOP_LEVEL')
    expect(codes(r)).not.toContain('LEGACY_PACKAGE_JSON')
  })

  it('serves a second build from the compile cache', async () => {
    const root = await app()
    const cache = createCompileCache(null)
    await assemblePwapp(root, { cache })
    const r = await assemblePwapp(root, { cache, shellExtra: '<!--x-->', envelopeEntries: { 'auth.json': { provider: 'password' } } })
    expect(r.stats.fromCache).toBe(r.stats.compiled)
    expect(text(r.files.get('index.html'))).toContain('<!--x-->')
    expect(parse(r.files.get('pwpack/auth.json'))).toEqual({ provider: 'password' })
  })

  it('an app that requires sign-in: no renderer preload, and without auth.json the identity says it has no door', async () => {
    const root = await app()
    await writeFile(join(root, 'app', 'definitions', 'auth.json'), JSON.stringify({ required: true, topology: 'external' }))
    const bare = await assemblePwapp(root, { cacheDir: null })
    const project = parse(bare.files.get('pwpack/project.json')) as { identity?: Record<string, unknown> }
    // No auth.json ships, so the runner must not ask for it (it would 404).
    expect(bare.files.has('pwpack/auth.json')).toBe(false)
    expect(project.identity).toMatchObject({ required: true, door: false })
    // The gate's visitor may never need the renderer.
    expect(text(bare.files.get('index.html'))).not.toContain('assets/embed')
    const hosted = await assemblePwapp(root, { cacheDir: null, envelopeEntries: { 'auth.json': { provider: 'oauth2-pkce', issuer: 'https://id.example.com', clientId: 'c' } } })
    expect((parse(hosted.files.get('pwpack/project.json')) as { identity?: Record<string, unknown> }).identity?.['door']).toBeUndefined()
  })

  it('describes each page: its own description, else the plan’s', async () => {
    const root = await app()
    const receiptPath = join(root, 'app', 'surfaces', 'home.receipt.json')
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as Record<string, unknown>
    await writeFile(receiptPath, JSON.stringify({ ...receipt, description: 'The home page.' }))
    const fromPage = await assemblePwapp(root, { cacheDir: null })
    expect(text(fromPage.files.get('index.html'))).toContain('<meta name="description" content="The home page." />')
    expect((parse(fromPage.files.get('pwpack/project.json')) as Record<string, unknown>)['description']).toBeUndefined()
    const planPath = join(root, 'app', 'plan.json')
    const plan = JSON.parse(await readFile(planPath, 'utf8').catch(() => '{}')) as Record<string, unknown>
    await writeFile(planPath, JSON.stringify({ ...plan, description: 'A demo app.' }))
    // The page's own wins, as the runner keeps it (envelope §4).
    const both = await assemblePwapp(root, { cacheDir: null })
    expect(text(both.files.get('index.html'))).toContain('<meta name="description" content="The home page." />')
    expect((parse(both.files.get('pwpack/project.json')) as Record<string, unknown>)['description']).toBe('A demo app.')
    await writeFile(receiptPath, JSON.stringify(receipt))
    const fromPlan = await assemblePwapp(root, { cacheDir: null })
    expect(text(fromPlan.files.get('index.html'))).toContain('<meta name="description" content="A demo app." />')
    expect(text(fromPlan.files.get('index.html'))).toContain('<meta property="og:description" content="A demo app." />')
  })

  it('says which command fills a missing pack cache', async () => {
    const root = await app(false)
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok).toBe(false)
    const missing = r.diagnostics.find((d) => d.code === 'PACK_NOT_CACHED')
    expect(missing?.message).toContain('pwf add @pwpack/k/kit@1.0.0')
    expect(missing?.message).toContain('.pwf/packs/@pwpack/k/kit@1.0.0/')
    expect(codes(r)).toContain('UNKNOWN_BLOCK_TYPE')
    expect(codes(r)).toContain('THEME_NOT_FOUND')
  })

  it("serves the app's own sign-in screen beside its routes, never as one", async () => {
    const root = await app()
    const identity = JSON.parse(await readFile(join(root, 'pwpack.json'), 'utf8')) as { app: Record<string, unknown> }
    await writeFile(join(root, 'pwpack.json'), JSON.stringify({ ...identity, app: { ...identity.app, signIn: 'sign-in' } }))
    await writeFile(join(root, 'app/surfaces/sign-in.receipt.json'), JSON.stringify({ title: 'Sign in', blocks: [{ id: 'si', type: 'title', props: { text: 'Welcome back' } }] }))
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    const project = parse(r.files.get('pwpack/project.json')) as Record<string, unknown>
    expect(project).toMatchObject({ surfaceOrder: ['home'], signInSurfaceId: 'sign-in' })
    expect((project.surfaceReceiptFiles as Record<string, string>)['sign-in']).toBe('surfaces/sign-in.receipt.json')
    expect(r.files.has('pwpack/surfaces/sign-in.receipt.json')).toBe(true)
    expect(text(r.files.get('pwpack/navigation.json'))).not.toContain('sign-in')
    await rm(join(root, 'app/surfaces/sign-in.receipt.json'))
    const broken = await assemblePwapp(root, { cacheDir: null })
    expect(broken.ok).toBe(false)
    expect(broken.diagnostics.some((d) => d.path === 'app/surfaces/sign-in.receipt.json' && d.severity === 'error')).toBe(true)
  })

  it("serves the app's own not-found page beside its routes, never as one", async () => {
    // An unknown route rendered the runner's page outside the app shell; the app
    // declares its own (`app.notFound`), drawn like a page but not a route.
    const root = await app()
    const identity = JSON.parse(await readFile(join(root, 'pwpack.json'), 'utf8')) as { app: Record<string, unknown> }
    await writeFile(join(root, 'pwpack.json'), JSON.stringify({ ...identity, app: { ...identity.app, notFound: 'missing' } }))
    await writeFile(join(root, 'app/surfaces/missing.receipt.json'), JSON.stringify({ title: 'Not found', blocks: [{ id: 'nf', type: 'title', props: { text: 'Not here' } }] }))
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    const project = parse(r.files.get('pwpack/project.json')) as Record<string, unknown>
    expect(project).toMatchObject({ surfaceOrder: ['home'], notFoundSurfaceId: 'missing' })
    expect((project.surfaceReceiptFiles as Record<string, string>).missing).toBe('surfaces/missing.receipt.json')
    expect(r.files.has('pwpack/surfaces/missing.receipt.json')).toBe(true)
    expect(r.stats.pages).toBe(1)
    // Not in the derived navigation.
    expect(text(r.files.get('pwpack/navigation.json'))).not.toContain('missing')

    // A declared not-found page without its receipt is an error.
    await rm(join(root, 'app/surfaces/missing.receipt.json'))
    const broken = await assemblePwapp(root, { cacheDir: null })
    expect(broken.ok).toBe(false)
    expect(broken.diagnostics.some((d) => d.path === 'app/surfaces/missing.receipt.json' && d.severity === 'error')).toBe(true)
  })

  it("writes each own-records source's declared field names on it, so a write sends only those", async () => {
    const root = await app()
    await mkdir(join(root, 'app/definitions'), { recursive: true })
    await writeFile(
      join(root, 'app/definitions/entities.json'),
      JSON.stringify({ entities: [{ typeId: 'Booking', fields: [{ name: 'name', type: 'text' }] }] })
    )
    const home = JSON.parse(await readFile(join(root, 'app/surfaces/home.receipt.json'), 'utf8')) as Record<string, unknown>
    await writeFile(
      join(root, 'app/surfaces/home.receipt.json'),
      JSON.stringify({
        ...home,
        capabilities: [{ capability: 'platform/persistence', config: { dataSources: [{ id: 'b', kind: 'entity', entityType: 'Booking' }] } }],
      })
    )
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    const served = parse(r.files.get('pwpack/surfaces/home.receipt.json')) as { capabilities: { config: { dataSources: unknown[] } }[] }
    expect(served.capabilities[0]?.config.dataSources).toEqual([{ id: 'b', kind: 'entity', entityType: 'Booking', fields: { name: 'text' } }])
  })

  it('reports an unknown block type, a broken receipt and a broken definition', async () => {
    const root = await app()
    await writeFile(
      join(root, 'pwpack.json'),
      JSON.stringify({
        id: '@pwpack/k/demo',
        version: '0.1.0',
        app: { entry: 'home', surfaceOrder: ['home', 'broken', 'gone'] },
        packs: [{ id: '@pwpack/k/kit', version: '1.0.0', hash: 'sha256:x' }],
      })
    )
    await writeFile(join(root, 'app/surfaces/home.receipt.json'), JSON.stringify({ title: 'Home', blocks: [{ type: 'nope' }, { type: 'kit.title' }] }))
    await writeFile(join(root, 'app/surfaces/broken.receipt.json'), '{ not json')
    await writeFile(join(root, 'app/definitions/navigation.json'), '{ nor this')
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok).toBe(false)
    expect(codes(r)).toEqual(expect.arrayContaining(['UNKNOWN_BLOCK_TYPE', 'RECEIPT_INVALID', 'DEFINITION_INVALID']))
    expect(r.diagnostics.some((d) => d.path === 'app/surfaces/gone.receipt.json')).toBe(true)
    // Files are still laid out as far as the build got.
    expect(r.files.has('index.html')).toBe(true)
  })

  it('fails a page whose block did not compile, and quiets an unused broken pack atom', async () => {
    const root = await app()
    const kit = join(root, ...PACK_REL)
    await writeFile(join(kit, 'atoms/blocks/text/title/component.tsx'), `import x from 'left-pad'\nexport default x\n`)
    let r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok).toBe(false)
    expect(codes(r)).toContain('BLOCK_NOT_COMPILED')
    expect(r.diagnostics.find((d) => d.code === 'NON_HOST_IMPORT')?.severity).toBe('error')

    await writeFile(join(root, 'app/surfaces/home.receipt.json'), JSON.stringify({ title: 'Home', blocks: [{ type: 'stack' }] }))
    r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    expect(r.diagnostics.find((d) => d.code === 'NON_HOST_IMPORT')?.severity).toBe('warning')
  })

  it('allows the origins a placed block declares, and not those of a block no page places', async () => {
    const root = await app()
    const kit = join(root, ...PACK_REL)
    const withOrigins = async (rel: string, origins: unknown): Promise<void> => {
      const m = JSON.parse(await readFile(join(kit, rel), 'utf8')) as { definition: Record<string, unknown> }
      await writeFile(join(kit, rel), JSON.stringify({ ...m, definition: { ...m.definition, origins } }))
    }
    // Placed on home: its origin is allowed.
    await withOrigins('atoms/blocks/text/title/manifest.json', { frame: ['https://www.openstreetmap.org'] })
    // Installed but placed nowhere: its origin is not.
    await mkdir(join(kit, 'atoms/blocks/media/map'), { recursive: true })
    await cp(join(kit, 'atoms/blocks/text/title/component.tsx'), join(kit, 'atoms/blocks/media/map/component.tsx'))
    const title = JSON.parse(await readFile(join(kit, 'atoms/blocks/text/title/manifest.json'), 'utf8')) as Record<string, unknown>
    await writeFile(
      join(kit, 'atoms/blocks/media/map/manifest.json'),
      JSON.stringify({ ...title, id: 'media.map', category: 'media', name: 'map', definition: { ...(title['definition'] as object), origins: { connect: ['https://tiles.example.com'] } } })
    )
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    const policy = (parse(r.files.get('publish.json')) as { csp: { policy: string } }).csp.policy
    expect(policy).toContain('frame-src https://www.openstreetmap.org')
    expect(policy).not.toContain('tiles.example.com')

    // A malformed declaration on a placed block fails the build with its code.
    await withOrigins('atoms/blocks/text/title/manifest.json', { frame: ['https://www.openstreetmap.org/export/embed.html'] })
    const bad = await assemblePwapp(root, { cacheDir: null })
    expect(bad.ok).toBe(false)
    expect(bad.diagnostics.find((d) => d.code === 'BLOCK_ORIGIN_INVALID')).toMatchObject({ severity: 'error' })
  })

  it("carries each placed block's prop declarations into blocks/manifest.json, without their prose", async () => {
    const root = await app()
    const rel = join(root, ...PACK_REL, 'atoms/blocks/text/title/manifest.json')
    const m = JSON.parse(await readFile(rel, 'utf8')) as { definition: { props: Record<string, unknown>[] } }
    m.definition.props = [
      { name: 'text', type: 'string', default: '', copy: true, description: 'For people', jsonSchema: { type: 'string', description: 'The words', default: '' } },
      { name: 'level', type: 'number', bindable: false, required: true, jsonSchema: { type: 'integer', minimum: 1, maximum: 6 } },
      { name: 'note', type: 'string', bindable: true },
      { name: 'items', jsonSchema: { type: 'array', items: { type: 'object', properties: { label: { type: 'string', title: 'Label' } } } } },
      { name: 'broken', bindable: 'no' },
    ]
    await writeFile(rel, JSON.stringify(m))
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    const blocks = parse(r.files.get('blocks/manifest.json')) as { blockType: string; definition: unknown }[]
    expect(blocks.find((b) => b.blockType === 'title')?.definition).toEqual({
      name: 'title',
      props: [
        { name: 'text', default: '', jsonSchema: { type: 'string', default: '' } },
        { name: 'level', bindable: false, required: true, jsonSchema: { type: 'integer', minimum: 1, maximum: 6 } },
        { name: 'note', bindable: true },
        { name: 'items', jsonSchema: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' } } } } },
        { name: 'broken' },
      ],
    })
    expect(blocks.find((b) => b.blockType === 'stack')?.definition).toEqual({
      name: 'stack',
      props: [{ name: 'gap', default: '16px', jsonSchema: { type: 'string' } }],
    })
  })

  it('refuses a folder that is not an app, or not a pwpack at all', async () => {
    const root = await app()
    await writeFile(join(root, 'pwpack.json'), JSON.stringify({ id: '@pwpack/k/demo', version: '0.1.0' }))
    expect(codes(await assemblePwapp(root, { cacheDir: null }))).toContain('NOT_AN_APP')
    await rm(join(root, 'pwpack.json'))
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok).toBe(false)
    expect(r.files.size).toBe(0)
    const missing = await assemblePwapp(join(root, 'does-not-exist'), { cacheDir: null })
    expect(codes(missing)).toEqual(['APP_UNREADABLE'])
  })

  it('checks the entry page, and makes up no title or language for an app that states none', async () => {
    const root = await app()
    await writeFile(join(root, 'pwpack.json'), JSON.stringify({
      id: '@pwpack/k/my-demo_app', version: '0.1.0', app: { entry: 'start', surfaceOrder: ['home'] },
      packs: [{ id: '@pwpack/k/kit', version: '1.0.0', hash: 'sha256:x' }],
    }))
    await rm(join(root, 'app/plan.json'))
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(codes(r)).toContain('ENTRY_NOT_A_PAGE')
    // A humanised pack id ("My Demo App") and `lang="en"` were words and a
    // language the app never chose.
    expect(text(r.files.get('index.html'))).toContain('<title></title>')
    expect(text(r.files.get('index.html'))).toContain('<html>')
    expect(parse(r.files.get('pwpack/project.json'))).not.toHaveProperty('title')
  })

  it('carries the plan’s messages and locale into project.json, and boots the runner without a locale of its own', async () => {
    const root = await app()
    const planPath = join(root, 'app', 'plan.json')
    const plan = JSON.parse(await readFile(planPath, 'utf8')) as Record<string, unknown>
    await writeFile(
      planPath,
      JSON.stringify({ ...plan, locale: 'tr-TR', messages: { 'gate.title': 'Oturum açın', 'ui.close': 'Kapat', bad: 3 } })
    )
    const r = await assemblePwapp(root, { cacheDir: null })
    const project = parse(r.files.get('pwpack/project.json')) as Record<string, unknown>
    expect(project['locale']).toBe('tr-TR')
    expect(project['messages']).toEqual({ 'gate.title': 'Oturum açın', 'ui.close': 'Kapat' })
    expect(r.diagnostics.find((d) => d.code === 'MESSAGES_INVALID')?.message).toContain('messages["bad"]')
    expect(text(r.files.get('index.html'))).toContain('<html lang="tr-TR">')
    expect(text(r.files.get(asset(r, 'boot')))).not.toContain('locale')
  })

  it('names block atoms by id, manifest name and short forms', () => {
    expect(blockNames({ id: 'data.big.table', manifest: { name: 'grid' } })).toEqual(['data.big.table', 'grid', 'big.table', 'table'])
    expect(blockNames({ id: 'solo' })).toEqual(['solo'])
  })
})

describe('ENGINE_RANGE_EXCLUDED (E8)', () => {
  const setEngines = async (file: string, range: string): Promise<void> => {
    const json = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    await writeFile(file, JSON.stringify({ ...json, engines: { pwfabric: range } }))
  }

  it('refuses an app whose engines range excludes the running engine, naming the fix', async () => {
    const root = await app()
    await setEngines(join(root, 'pwpack.json'), '>=2.1 <3')
    const r = await assemblePwapp(root, { engineVersion: '3.0.0' })
    expect(r.ok).toBe(false)
    const d = r.diagnostics.find((x) => x.code === 'ENGINE_RANGE_EXCLUDED')
    expect(d).toMatchObject({ severity: 'error', path: 'pwpack.json' })
    expect(d!.message).toContain('">=2.1 <3"')
    expect(d!.message).toContain('">=3.0 <4"')
  })

  it('refuses a pinned pack made for another engine; a range that names the engine passes', async () => {
    const root = await app()
    await setEngines(join(root, ...PACK_REL, 'pwpack.json'), '>=2.1 <3')
    const r = await assemblePwapp(root, { engineVersion: '3.0.0' })
    expect(r.diagnostics.filter((x) => x.code === 'ENGINE_RANGE_EXCLUDED').map((x) => x.message)).toEqual([
      expect.stringContaining('@pwpack/k/kit@1.0.0 declares engines.pwfabric ">=2.1 <3"'),
    ])
    const fine = await assemblePwapp(root, { engineVersion: '2.4.0' })
    expect(codes(fine)).not.toContain('ENGINE_RANGE_EXCLUDED')
    // A prerelease of the engine runs what its release runs.
    await setEngines(join(root, ...PACK_REL, 'pwpack.json'), '>=3.0.0 <4')
    expect(codes(await assemblePwapp(root, { engineVersion: '3.0.0-rc.2' }))).not.toContain('ENGINE_RANGE_EXCLUDED')
  })
})

describe('the router a build writes (pwf build --router)', () => {
  it('writes hash routing by default, with no base and no router meta', async () => {
    const root = await app()
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    const html = text(r.files.get('index.html'))
    expect(html).not.toContain('<base')
    expect(html).not.toContain('<meta name="pw-router"')
    expect(text(r.files.get(asset(r, 'boot')))).toContain(`router: "hash"`)
  })

  it('path: runApp routes by path and the shell declares the base; auto also declares the fallback', async () => {
    const root = await app()
    const path = await assemblePwapp(root, { cacheDir: null, router: 'path' })
    expect(path.ok, codes(path).join()).toBe(true)
    const html = text(path.files.get('index.html'))
    expect(html).toContain('<base href="/" />')
    expect(html.indexOf('<base')).toBeLessThan(html.indexOf('./assets/'))
    expect(html).not.toContain('<meta name="pw-router"')
    expect(text(path.files.get(asset(path, 'boot')))).toContain(`router: "path"`)
    // The inline scripts read the address as the runner will.
    expect(/id="pw-page-hints">([^<]*)</.exec(html)?.[1]).toContain('"router":"path"')

    const auto = await assemblePwapp(root, { cacheDir: null, router: 'auto', base: '/shop/' })
    const autoHtml = text(auto.files.get('index.html'))
    expect(autoHtml).toContain('<base href="/shop/" />')
    expect(autoHtml).toContain('<meta name="pw-router" content="path" />')
    expect(text(auto.files.get(asset(auto, 'boot')))).toContain(`router: "auto"`)
  })
})

describe('atomsLine', () => {
  const stats = { pages: 1, blocks: 1, engines: 0, atoms: 57, compiled: 56, fromCache: 3, failed: 0 }
  it('names every atom the count leaves out, with why', () => {
    expect(atomsLine(stats)).toBe('56/57 atoms compiled (3 from cache)')
    expect(atomsLine({ ...stats, skipped: [{ id: 'RestConnector', reason: 'connector declared as data, no code to compile' }] })).toBe(
      '56/57 atoms compiled (3 from cache; 1 skipped: RestConnector (connector declared as data, no code to compile))'
    )
    const many = ['a', 'b', 'c', 'd'].map((id) => ({ id, reason: 'connector declared as data, no code to compile' }))
    expect(atomsLine({ ...stats, compiled: 52, failed: 1, skipped: many })).toBe(
      '52/57 atoms compiled (3 from cache; 4 skipped: a, b, c and 1 more (connector declared as data, no code to compile); 1 failed (see the errors above))'
    )
  })

  it('a build counts a connector that is a declaration only as skipped, by id', async () => {
    const root = await app()
    const r = await assemblePwapp(root, { cacheDir: null })
    const skipped = r.stats.skipped ?? []
    expect(r.stats.atoms - r.stats.compiled - r.stats.failed).toBe(skipped.length)
    for (const s of skipped) expect(s.reason).toMatch(/declared as data, no code to compile/)
  })
})

describe('loadSources', () => {
  it('reuses a remembered pack build and warns on a pin that disagrees with the cache', async () => {
    const root = await app()
    const memo: PackMemo = new Map()
    const first = await loadSources(root, memo)
    expect(first.packs).toHaveLength(1)
    expect(memo.size).toBe(1)
    const second = await loadSources(root, memo)
    expect(second.packs[0]?.folder).toBe(first.packs[0]?.folder)

    const kit = join(root, ...PACK_REL)
    const id = JSON.parse(await readFile(join(kit, 'pwpack.json'), 'utf8')) as Record<string, unknown>
    await writeFile(join(kit, 'pwpack.json'), JSON.stringify({ ...id, version: '9.9.9' }))
    const third = await loadSources(root)
    expect(third.diagnostics.map((d) => d.code)).toContain('PACK_IDENTITY_MISMATCH')
  })

  it('refuses a pin that cannot name a cache folder', async () => {
    expect(packCacheRel('@a/b', '1.0.0')).toBe('.pwf/packs/@a/b@1.0.0')
    expect(packCacheRel('../x', '1')).toBeNull()
    expect(packCacheRel('a', '1:2')).toBeNull()
    const root = await app()
    await writeFile(join(root, 'pwpack.json'), JSON.stringify({
      id: '@pwpack/k/demo', version: '0.1.0', app: { entry: 'home', surfaceOrder: ['home'] },
      packs: [{ id: '../evil', version: '1', hash: 'h' }, { id: '@pwpack/k/kit', version: '1.0.0', hash: 'h' }],
    }))
    const r = await loadSources(root)
    expect(r.diagnostics.map((d) => d.code)).toContain('PIN_INVALID')
  })
})
