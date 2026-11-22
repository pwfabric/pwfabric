import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { cp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { main } from '../../index.js'
import { runShoot, shotName } from '../../commands/shoot.js'
import { parseArgs } from '../../args.js'
import type { Chromium } from '../../commands/lib/hydration.js'
import { capture, FIXTURE_FOUNDATION, tempDir } from './helpers.js'

/** A Chromium that records what it is asked and writes an empty file per screenshot. */
function fakeChromium(log: string[]): Chromium {
  return {
    launch: async (options) => ({
      newContext: async ({ viewport, serviceWorkers }) => ({
        route: async (url: RegExp) => {
          log.push(`guard ${serviceWorkers} ${url.test('https://example.com/') && !url.test('http://127.0.0.1:1/')} ${options?.args?.join(' ') ?? ''}`)
        },
        close: async () => {},
        newPage: async () => {
        let scheme = ''
        return {
          on: () => {},
          route: async () => {},
          addInitScript: async () => {},
          emulateMedia: async ({ colorScheme }) => {
            scheme = colorScheme
          },
          goto: async (url: string) => {
            const res = await fetch(url)
            log.push(`${new URL(url).pathname}${new URL(url).hash} ${res.status} @${viewport.width} ${scheme}`)
          },
          waitForTimeout: async () => {},
          evaluate: async () => undefined as never,
          screenshot: async ({ path }) => {
            await writeFile(path, '')
          },
          close: async () => {},
        }
        },
      }),
      close: async () => {},
    }),
  }
}

async function built(router: string): Promise<{ cwd: string; root: string }> {
  const cwd = await tempDir()
  expect(await main(['create', 'demo', '--foundation', FIXTURE_FOUNDATION], capture(cwd).io)).toBe(0)
  const root = join(cwd, 'demo')
  expect(await main(['page', 'add', 'pricing'], capture(root).io)).toBe(0)
  const b = capture(root)
  expect(await main(['build', '--router', router], b.io), b.text()).toBe(0)
  return { cwd, root }
}

describe('pwf shoot', () => {
  it('names files after their address', () => {
    expect(shotName('/')).toBe('home')
    expect(shotName('/#/pricing')).toBe('pricing')
    expect(shotName('/de/preise/')).toBe('de-preise')
    expect(shotName('/dish/?id=3')).toBe('dish')
  })

  it('serves the build and shoots every page at each width and scheme', async () => {
    const { root } = await built('path')
    const log: string[] = []
    const c = capture(root)
    expect(await runShoot(parseArgs(['shoot', '--widths', '390,1440', '--theme', 'light,dark']).args, c.io, { loadPlaywright: async () => fakeChromium(log), settleMs: 0 }), c.text()).toBe(0)
    expect(log).toContain('/ 200 @390 light')
    expect(log).toContain('/pricing/ 200 @1440 dark')
    expect(log.filter((l) => !l.startsWith('guard'))).toHaveLength(8)
    // Each page in a context of its own: service workers blocked, other hosts refused, no name resolved but this machine's.
    expect(new Set(log.filter((l) => l.startsWith('guard')))).toEqual(new Set(['guard block true --host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost']))
    for (const f of ['home@390-light.png', 'home@1440-dark.png', 'pricing@390-dark.png']) expect(existsSync(join(root, '.pwf', 'shots', f))).toBe(true)
    expect(c.out.at(-1)).toMatch(/^8 screenshots in /)
  })

  it('takes the addresses --path names, hash routes too', async () => {
    const { cwd, root } = await built('hash')
    const log: string[] = []
    const out = join(cwd, 'pics')
    expect(await runShoot(parseArgs(['shoot', '--path', '#/pricing', '--widths', '390', '--out', out]).args, capture(root).io, { loadPlaywright: async () => fakeChromium(log), settleMs: 0 })).toBe(0)
    expect(log.filter((l) => !l.startsWith('guard'))).toEqual(['/#/pricing 200 @390 light'])
    expect(existsSync(join(out, 'pricing@390.png'))).toBe(true)
  })

  it('says how to install Playwright when it is not there', async () => {
    const { root } = await built('path')
    const c = capture(root)
    expect(await runShoot(parseArgs(['shoot']).args, c.io, { loadPlaywright: async () => null })).toBe(1)
    expect(c.err.join('\n')).toMatch(/Playwright is not installed/)
  })

  it('refuses a second folder, widths that are no window and a scheme it does not have', async () => {
    const { root } = await built('path')
    const run = (argv: string[]) => runShoot(parseArgs(['shoot', ...argv]).args, capture(root).io, { loadPlaywright: async () => fakeChromium([]), settleMs: 0 })
    await expect(run(['a', 'b'])).rejects.toThrow(/unexpected argument "b"/)
    await expect(run(['--widths', '90'])).rejects.toThrow(/--widths takes window widths/)
    await expect(run(['--theme', 'sepia'])).rejects.toThrow(/--theme takes light, dark or both \(not "sepia"\)/)
  })

  it('shoots one locale’s pages, refuses a locale the app does not have, takes paths with or without a slash, and reports --json', async () => {
    const { cwd, root } = await built('path')
    expect(await main(['locale', 'add', 'de'], capture(root).io)).toBe(0)
    expect(await main(['build', '--router', 'path'], capture(root).io)).toBe(0)
    const log: string[] = []
    const c = capture(root)
    expect(await runShoot(parseArgs(['shoot', '--locale', 'de', '--widths', '390']).args, c.io, { loadPlaywright: async () => fakeChromium(log), settleMs: 0 })).toBe(0)
    expect(log.filter((l) => !l.startsWith('guard')).every((l) => l.startsWith('/de/'))).toBe(true)
    await expect(runShoot(parseArgs(['shoot', '--locale', 'fr']).args, capture(root).io, { loadPlaywright: async () => fakeChromium([]), settleMs: 0 })).rejects.toThrow(
      /--locale fr: the app has no such locale \(it has en, de\)|--locale fr: the app has no such locale \(it has de, en\)/
    )
    const paths: string[] = []
    const out = join(cwd, 'shots')
    const j = capture(root)
    expect(await runShoot(parseArgs(['shoot', '--path', 'pricing/', '--path', '/', '--widths', '390', '--out', out, '--json']).args, j.io, { loadPlaywright: async () => fakeChromium(paths), settleMs: 0 })).toBe(0)
    expect(paths.filter((l) => !l.startsWith('guard'))).toEqual(['/pricing/ 200 @390 light', '/ 200 @390 light'])
    expect(JSON.parse(j.out.join('\n'))).toMatchObject({ dir: out })
  })

  it('shoots a built folder that is no app into ./shots, in dark when asked', async () => {
    const { cwd, root } = await built('hash')
    const site = join(cwd, 'site')
    await cp(join(root, '.pwf', 'out'), site, { recursive: true })
    const log: string[] = []
    expect(await runShoot(parseArgs(['shoot', site, '--widths', '390', '--theme', 'dark']).args, capture(cwd).io, { loadPlaywright: async () => fakeChromium(log), settleMs: 0 })).toBe(0)
    expect(existsSync(join(cwd, 'shots', 'home@390-dark.png'))).toBe(true)
  })
})
