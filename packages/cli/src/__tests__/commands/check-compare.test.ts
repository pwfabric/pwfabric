import { describe, expect, it } from 'vitest'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { main } from '../../index.js'
import { runCheck, documentLinks } from '../../commands/check.js'
import { parseArgs } from '../../args.js'
import { recordPageInfo } from '../../commands/lib/hydration.js'
import { capture, FIXTURE_FOUNDATION, tempDir } from './helpers.js'

async function app(): Promise<{ cwd: string; root: string }> {
  const cwd = await tempDir()
  expect(await main(['create', 'demo', '--foundation', FIXTURE_FOUNDATION], capture(cwd).io)).toBe(0)
  const root = join(cwd, 'demo')
  expect(await main(['page', 'add', 'pricing', '--title', 'Pricing'], capture(root).io)).toBe(0)
  await writeFile(join(root, 'app', 'surfaces', 'home.receipt.json'), JSON.stringify({ title: 'Home', blocks: [{ id: 'h', type: 'heading', props: { text: 'Hello' } }] }))
  return { cwd, root }
}

async function build(root: string, out: string, router = 'path'): Promise<void> {
  const c = capture(root)
  expect(await main(['build', '--router', router, '--out', out], c.io), c.text()).toBe(0)
}

describe('documentLinks', () => {
  it('reads href, src and srcset, but not inline script text', () => {
    const html = '<a href="pricing/">x</a><img src="pwpack/media/a.png" srcset="pwpack/media/a.png 1x, pwpack/media/b.png 2x"><script>const s = "<a href=\'nope\'>"</script><script src="./assets/x.js"></script>'
    expect(documentLinks(html)).toEqual(['pricing/', 'pwpack/media/a.png', 'pwpack/media/a.png', 'pwpack/media/b.png', './assets/x.js'])
  })
})

describe('pwf check', () => {
  it('passes a fresh build, and reports a broken link and an over-budget page', async () => {
    const { cwd, root } = await app()
    const out = join(cwd, 'out')
    await build(root, out)
    const ok = capture(cwd)
    expect(await main(['check', out], ok.io), ok.text()).toBe(0)
    expect(ok.out.some((l) => /^links: \d+ checked, 0 broken$/.test(l))).toBe(true)
    expect(ok.text()).toMatch(/\/pricing\/\s+[\d.]+ KB raw/)

    const index = join(out, 'index.html')
    await writeFile(index, (await readFile(index, 'utf8')).replace('</body>', '<a href="gone/">x</a><a href="#/nope">y</a><a href="https://example.com/">z</a></body>'))
    const bad = capture(cwd)
    expect(await main(['check', out, '--links'], bad.io)).toBe(1)
    expect(bad.err).toContain('  BROKEN index.html: gone/ — the build serves nothing there')
    expect(bad.err.join('\n')).not.toMatch(/example\.com/)

    const heavy = capture(cwd)
    expect(await main(['check', out, '--weight', '--budget', '1'], heavy.io)).toBe(1)
    expect(heavy.err.join('\n')).toMatch(/OVER BUDGET/)
    const json = capture(cwd)
    await main(['check', out, '--json'], json.io)
    const report = JSON.parse(json.out.join('\n'))
    expect(report.ok).toBe(false)
    expect(report.links.broken).toHaveLength(2)
  })

  it('--weight counts a video\'s poster up front and lists the video apart unless the page plays or preloads it', async () => {
    const { cwd, root } = await app()
    const out = join(cwd, 'out')
    await build(root, out)
    await mkdir(join(out, 'media'), { recursive: true })
    await writeFile(join(out, 'media', 'clip.mp4'), new Uint8Array(400 * 1024).map((_, i) => (i * 7919) % 251))
    await writeFile(join(out, 'media', 'loop.webm'), new Uint8Array(300 * 1024).map((_, i) => (i * 104729) % 241))
    await writeFile(join(out, 'media', 'poster.jpg'), new Uint8Array(2048).fill(7))
    const index = join(out, 'index.html')
    const html = await readFile(index, 'utf8')
    const page = (video: string) => writeFile(index, html.replace('</body>', `${video}</body>`))
    const weigh = async () => {
      const c = capture(cwd)
      await main(['check', out, '--weight', '--json'], c.io)
      return (JSON.parse(c.out.join('\n')).weight.documents as { document: string; raw: number; files: number; deferred: { file: string; raw: number }[] }[]).find((d) => d.document === 'index.html')!
    }
    const bare = await weigh()

    await page('<video preload="metadata" poster="media/poster.jpg"><source src="media/clip.mp4" type="video/mp4"></video><video src="media/loop.webm" preload="none"></video>')
    const deferred = await weigh()
    expect(deferred.raw - bare.raw).toBeLessThan(8 * 1024)
    expect(deferred.files).toBe(bare.files + 1)
    expect(deferred.deferred.map((d) => d.file).sort()).toEqual(['media/clip.mp4', 'media/loop.webm'])
    const lines = capture(cwd)
    await main(['check', out, '--weight'], lines.io)
    expect(lines.text()).toMatch(/media\/clip\.mp4\s+[\d.]+ KB raw, not counted: the browser loads it when it plays/)

    await page('<video autoplay muted src="media/clip.mp4"></video><video preload="auto" src="media/loop.webm"></video>')
    const upfront = await weigh()
    expect(upfront.raw - bare.raw).toBeGreaterThan(700 * 1024)
    expect(upfront.deferred).toEqual([])
  })

  it('follows _redirects and accepts hash routes of the app', async () => {
    const { cwd, root } = await app()
    const plan = JSON.parse(await readFile(join(root, 'app', 'plan.json'), 'utf8'))
    plan.redirects = [{ from: '/prices/', to: '/pricing/' }]
    await writeFile(join(root, 'app', 'plan.json'), JSON.stringify(plan))
    const out = join(cwd, 'hash')
    await build(root, out, 'hash')
    const index = join(out, 'index.html')
    await writeFile(index, (await readFile(index, 'utf8')).replace('</body>', '<a href="#/pricing">p</a><a href="/prices/">r</a></body>'))
    const c = capture(cwd)
    expect(await main(['check', out, '--links'], c.io), c.text()).toBe(1)
    // /prices/ redirects to /pricing/, which a hash build has no document for.
    expect(c.err.join('\n')).toMatch(/\/prices\/ — redirects to \/pricing\/, which the build does not serve/)
    expect(c.err.join('\n')).not.toMatch(/#\/pricing/)
  })

  it('accepts the entry at its key in every locale of a hash build', async () => {
    const { cwd, root } = await app()
    expect(await main(['locale', 'add', 'de'], capture(root).io)).toBe(0)
    const out = join(cwd, 'hash')
    await build(root, out, 'hash')
    const index = join(out, 'index.html')
    await writeFile(index, (await readFile(index, 'utf8')).replace('</body>', '<a href="#/home">h</a><a href="#/de/home">d</a><a href="#/de/nope">n</a></body>'))
    const c = capture(cwd)
    expect(await main(['check', out, '--links'], c.io), c.text()).toBe(1)
    expect(c.err.join('\n')).toMatch(/#\/de\/nope/)
    expect(c.err.join('\n')).not.toMatch(/#\/(?:de\/)?home\b/)
  })

  it('--hydration says how to install Playwright when it is not there', async () => {
    const { cwd, root } = await app()
    const out = join(cwd, 'out')
    await build(root, out)
    const c = capture(cwd)
    expect(await runCheck(parseArgs(['check', out, '--hydration']).args, c.io, { loadPlaywright: async () => null })).toBe(1)
    expect(c.err.join('\n')).toMatch(/Playwright is not installed\. It is an optional peer of pwf/)
  })

  it('opens a record page with a real id from its fallback rows', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, 'pwpack', 'surfaces'), { recursive: true })
    const receipt = {
      blocks: [],
      capabilities: [{ capability: 'platform/persistence', config: { dataSources: [{ id: 'dish', kind: 'entity', entityType: 'Dish', notFoundWhenEmpty: true, query: { id: '{{state.id}}' }, fallback: [{ id: 'd-1' }] }] } }],
    }
    await writeFile(join(dir, 'pwpack', 'surfaces', 'dish.receipt.json'), JSON.stringify(receipt))
    expect(recordPageInfo(dir, 'dish', null)).toMatchObject({ isRecord: true, query: '?id=d-1', hasFallbackId: true })
    expect(recordPageInfo(dir, 'none', null)).toMatchObject({ isRecord: false, query: '' })
  })
})

describe('pwf compare', () => {
  it('takes an old build’s nested app copies (runtime, blocks, pwpack) for no addresses, but keeps its public files', async () => {
    const { cwd, root } = await app()
    const before = join(cwd, 'before')
    await build(root, before)
    const nested = ['en/index.html', 'en/assets/app.1a2b3c4d.js', 'en/blocks/hero.js', 'en/shims/react.js', 'en/engines/core.js', 'en/pwpack/surfaces/home.json', 'en/pwpack/media/a.png']
    for (const rel of [...nested, 'docs/assets/logo.png']) {
      await mkdir(join(before, rel, '..'), { recursive: true })
      await writeFile(join(before, rel), 'x')
    }
    const after = join(cwd, 'after')
    await build(root, after)
    const c = capture(cwd)
    expect(await main(['compare', before, after, '--json'], c.io)).toBe(1)
    expect(JSON.parse(c.out.join('\n')).missing).toEqual(['docs/assets/logo.png'])
  })

  it('lists the pages the new build dropped, unless it redirects them', async () => {
    const { cwd, root } = await app()
    await mkdir(join(root, 'public', 'docs'), { recursive: true })
    await writeFile(join(root, 'public', 'docs', 'guide.txt'), 'guide')
    const before = join(cwd, 'before')
    await build(root, before)
    const same = capture(cwd)
    expect(await main(['compare', before, before], same.io)).toBe(0)
    expect(same.out.at(-1)).toMatch(/^0 addresses of the old build missing/)

    // The next version drops the pricing page and the public file.
    const id = JSON.parse(await readFile(join(root, 'pwpack.json'), 'utf8'))
    id.app.surfaceOrder = ['home']
    await writeFile(join(root, 'pwpack.json'), JSON.stringify(id))
    const plan = JSON.parse(await readFile(join(root, 'app', 'plan.json'), 'utf8'))
    plan.surfaces = plan.surfaces.filter((s: { key: string }) => s.key !== 'pricing')
    await writeFile(join(root, 'app', 'plan.json'), JSON.stringify(plan))
    await cp(join(root, 'app', 'surfaces', 'pricing.receipt.json'), join(cwd, 'pricing.bak'))
    const { rm } = await import('node:fs/promises')
    await rm(join(root, 'app', 'surfaces', 'pricing.receipt.json'))
    await rm(join(root, 'public'), { recursive: true })
    const after = join(cwd, 'after')
    await build(root, after)
    const c = capture(cwd)
    expect(await main(['compare', before, after], c.io)).toBe(1)
    expect(c.err).toContain('MISSING     /pricing/')
    expect(c.err).toContain('MISSING     /docs/guide.txt')

    // A redirect for it: no longer missing.
    plan.redirects = [{ from: '/pricing/', to: '/' }]
    await writeFile(join(root, 'app', 'plan.json'), JSON.stringify(plan))
    const redirected = join(cwd, 'redirected')
    await build(root, redirected)
    const r = capture(cwd)
    expect(await main(['compare', before, redirected, '--json'], r.io)).toBe(1)
    const result = JSON.parse(r.out.join('\n'))
    expect(result.missing).toEqual(['docs/guide.txt'])
    expect(result.redirected).toEqual([{ address: 'pricing/', to: '/' }])
  })
})
