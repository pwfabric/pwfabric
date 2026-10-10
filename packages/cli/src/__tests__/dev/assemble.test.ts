import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 60_000 })
import { assemblePwapp, blockNames } from '../../dev/assemble.js'
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

describe('assemblePwapp', () => {
  it('lays out a static pwapp from the app and its pinned pack', async () => {
    const root = await app()
    const r = await assemblePwapp(root, { publishedAt: '2026-10-06T00:00:00.000Z' })
    expect(r.ok, codes(r).join()).toBe(true)
    expect(r.stats).toMatchObject({ pages: 1, blocks: 2, engines: 2, atoms: 5, compiled: 4, failed: 0 })
    const paths = [...r.files.keys()]
    for (const p of [
      'index.html',
      'assets/runner.js',
      'assets/embed.js',
      'assets/theme.css',
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
      theme: { colors: { primary: '#7c2d12', background: '#fffbeb', text: '#1c1917', accent: '#b45309' }, typography: { fontFamily: 'Inter, system-ui, sans-serif' } },
    })
    expect(text(r.files.get('pwpack/connections.json'))).not.toContain('do-not-ship')
    expect(codes(r)).toContain('CREDENTIAL_DROPPED')
    expect(text(r.files.get('assets/theme.css'))).toContain('--pw-color-primary: #7c2d12')
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
    expect(csp.policy).toMatch(/^default-src 'none'; script-src 'self' blob: 'sha256-[A-Za-z0-9+/]+=*'; style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com;/)
    expect(csp.policy).toContain("font-src 'self' https://fonts.gstatic.com")
    expect(csp.policy).toContain("frame-ancestors 'none'")
    // The compiled engine's reach is not declared, so it is listed, not guessed.
    expect(csp.unresolved?.map((u) => u.source)).toEqual(['engine:Echo'])
    expect(text(r.files.get('_headers'))).toBe(`/*\n  Content-Security-Policy: ${csp.policy}\n`)
    const html = text(r.files.get('index.html'))
    const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)" \/>/.exec(html)?.[1]
    expect(meta).toBe(csp.policy.replace(/; frame-ancestors 'none'/, ''))
    expect(text(r.files.get('assets/seed.js'))).toContain('__pwfabric_core')
    expect(text(r.files.get('assets/boot.js'))).toContain('runApp(')
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

  it('checks the entry page and derives a title from the id', async () => {
    const root = await app()
    await writeFile(join(root, 'pwpack.json'), JSON.stringify({
      id: '@pwpack/k/my-demo_app', version: '0.1.0', app: { entry: 'start', surfaceOrder: ['home'] },
      packs: [{ id: '@pwpack/k/kit', version: '1.0.0', hash: 'sha256:x' }],
    }))
    await rm(join(root, 'app/plan.json'))
    const r = await assemblePwapp(root, { cacheDir: null })
    expect(codes(r)).toContain('ENTRY_NOT_A_PAGE')
    expect(text(r.files.get('index.html'))).toContain('<title>My Demo App</title>')
  })

  it('names block atoms by id, manifest name and short forms', () => {
    expect(blockNames({ id: 'data.big.table', manifest: { name: 'grid' } })).toEqual(['data.big.table', 'grid', 'big.table', 'table'])
    expect(blockNames({ id: 'solo' })).toEqual(['solo'])
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
