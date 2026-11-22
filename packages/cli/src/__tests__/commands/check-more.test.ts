/**
 * `pwf check`: the links a page names in all their forms, the flags it
 * refuses, and --hydration end to end through a stand-in Chromium.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { main } from '../../index.js'
import { brokenLinks, documentLinks, mediaLinks, runCheck } from '../../commands/check.js'
import { readBuiltOutput } from '../../commands/lib/built-output.js'
import { parseArgs } from '../../args.js'
import { capture, FIXTURE_FOUNDATION, tempDir } from './helpers.js'

async function built(router = 'path', base?: string): Promise<{ cwd: string; root: string; out: string }> {
  const cwd = await tempDir()
  expect(await main(['create', 'demo', '--foundation', FIXTURE_FOUNDATION], capture(cwd).io)).toBe(0)
  const root = join(cwd, 'demo')
  expect(await main(['page', 'add', 'pricing', '--title', 'Pricing'], capture(root).io)).toBe(0)
  const c = capture(root)
  expect(await main(['build', '--router', router, ...(base ? ['--base', base] : [])], c.io), c.text()).toBe(0)
  return { cwd, root, out: join(root, '.pwf', 'out') }
}

async function withBody(out: string, html: string): Promise<void> {
  const index = join(out, 'index.html')
  await writeFile(index, (await readFile(index, 'utf8')).replace('</body>', `${html}</body>`))
}

describe('documentLinks and mediaLinks', () => {
  it('read single-quoted attributes, entities and empty srcset parts', () => {
    expect(documentLinks(`<a href='a/?x=1&amp;y=2'>a</a><img srcset="b.png 1x, , c.png 2x">`)).toEqual(['a/?x=1&y=2', 'b.png', 'c.png'])
  })

  it('say why a video or audio file loads up front, from its own src or its sources', () => {
    expect(mediaLinks(`<video preload><source src='a.mp4'></video><audio preload=auto src="b.mp3"></audio><video autoplay src="c.webm"></video><video preload="none" src="d.mp4"></video>`)).toEqual([
      { url: 'a.mp4', kind: 'video', upfront: 'preload' },
      { url: 'b.mp3', kind: 'audio', upfront: 'preload' },
      { url: 'c.webm', kind: 'video', upfront: 'autoplay' },
      { url: 'd.mp4', kind: 'video' },
    ])
  })
})

describe('brokenLinks', () => {
  it('skips templates, anchors and other sites; takes the origin’s links as its own; names what is outside the base or no address', async () => {
    const { out } = await built('path', '/shop/')
    await withBody(
      out,
      [
        '<a href="{{state.next}}">t</a>',
        '<a href="#top">anchor</a>',
        '<a href="">empty</a>',
        '<a href="https://example.com/">other site</a>',
        '<a href="https://shop.example/shop/pricing/">own origin</a>',
        '<a href="https://shop.example">own origin root</a>',
        '<a href="/elsewhere/">outside</a>',
        '<a href="%E0%A4%A">bad</a>',
        '<a href="./#/pricing">hash route in path build</a>',
      ].join('')
    )
    const r = brokenLinks(await readBuiltOutput(out), 'https://shop.example')
    expect(r.broken.map((b) => `${b.link} — ${b.why}`)).toEqual(["https://shop.example — is outside the app's base /shop/", "/elsewhere/ — is outside the app's base /shop/", '%E0%A4%A — is not a valid address'])
  })

  it('accepts a redirect off-site', async () => {
    const { root, out } = await built()
    const plan = JSON.parse(await readFile(join(root, 'app', 'plan.json'), 'utf8'))
    plan.redirects = [{ from: '/docs/', to: 'https://docs.example.com/' }]
    await writeFile(join(root, 'app', 'plan.json'), JSON.stringify(plan))
    expect(await main(['build'], capture(root).io)).toBe(0)
    await withBody(out, '<a href="docs/">docs</a>')
    expect(brokenLinks(await readBuiltOutput(out)).broken).toEqual([])
  })
})

describe('runCheck flags', () => {
  it('refuses a second folder, a budget that is no size and widths that are no window', async () => {
    const { out } = await built()
    const run = (argv: string[]) => runCheck(parseArgs(['check', ...argv]).args, capture(out).io)
    await expect(run([out, 'extra'])).rejects.toThrow(/unexpected argument "extra"/)
    await expect(run([out, '--budget', '0'])).rejects.toThrow(/--budget takes kilobytes/)
    await expect(run([out, '--widths', '390,abc'])).rejects.toThrow(/--widths takes window widths/)
    await expect(run([out, '--widths', '100'])).rejects.toThrow(/--widths takes window widths/)
  })
})

/** A Chromium whose pages all keep and hydrate their frame, and that names each address it opens. */
function chromium(opened: string[], seen: Record<string, unknown> = {}) {
  return {
    launch: async () => ({
      newContext: async () => ({
        route: async () => {},
        close: async () => {},
        newPage: async () => ({
          on: () => {},
          route: async () => {},
          addInitScript: async () => {},
          goto: async (url: string) => void opened.push(url.replace(/^http:\/\/127\.0\.0\.1:\d+/, '')),
          waitForTimeout: async () => {},
          evaluate: async () => ({ shown: null, layoutLeft: false, painted: 5, kept: true, hydrated: true, gone: [], goneBlocks: [], ...seen }),
          close: async () => {},
        }),
      }),
      close: async () => {},
    }),
  }
}

describe('pwf check --hydration', () => {
  it('opens every painted page at each width, by path, and passes them', async () => {
    const { root, out } = await built('path')
    const opened: string[] = []
    const c = capture(root)
    expect(await runCheck(parseArgs(['check', out, '--hydration', '--widths', '390,1280']).args, c.io, { loadPlaywright: async () => chromium(opened) as never }), c.text()).toBe(0)
    expect(opened).toEqual(expect.arrayContaining(['/', '/pricing/']))
    expect(opened.filter((o) => o === '/')).toHaveLength(2)
    expect(c.out.join('\n')).toMatch(/ok {3}\/pricing\/ @1280/)
  })

  it('opens pages by hash route, fails a page that was not hydrated, and reports it in --json', async () => {
    const { root, out } = await built('hash')
    const opened: string[] = []
    const c = capture(root)
    expect(await runCheck(parseArgs(['check', out, '--hydration', '--json']).args, c.io, { loadPlaywright: async () => chromium(opened, { hydrated: false }) as never })).toBe(1)
    expect(opened).toContain('/#/pricing')
    const report = JSON.parse(c.out.join('\n'))
    expect(report.hydration.ok).toBe(false)
    expect(report.hydration.lines.join('\n')).toMatch(/FAIL \/#\/pricing @390\n {7}the painted root was not hydrated/)
  })

  it('has nothing to check in a build with no first paint', async () => {
    const { root, out } = await built('path')
    const index = join(out, 'index.html')
    await writeFile(index, (await readFile(index, 'utf8')).replace(/<script type="application\/json" id="pw-first-paint">[\s\S]*?<\/script>/, ''))
    const c = capture(root)
    expect(await runCheck(parseArgs(['check', out, '--hydration']).args, c.io, { loadPlaywright: async () => chromium([]) as never })).toBe(0)
    expect(c.out.join('\n')).toContain('hydration: no static first paint')
  })
})
