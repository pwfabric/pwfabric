import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { debounce, isWatchedPath, snapshot, watchFolder, type Watcher } from '../../dev/watcher.js'

vi.setConfig({ testTimeout: 30_000 })

let dirs: string[] = []
let watchers: Watcher[] = []
afterEach(async () => {
  watchers.forEach((w) => w.close())
  watchers = []
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })))
  dirs = []
})
async function folder(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'pwf-watch-'))
  dirs.push(d)
  await mkdir(join(d, 'app', 'surfaces'), { recursive: true })
  return d
}
const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('isWatchedPath', () => {
  it('ignores build output, version control and dependencies, but not the pack cache', () => {
    expect(isWatchedPath('app/surfaces/home.receipt.json')).toBe(true)
    expect(isWatchedPath('.pwf/packs/@pwpack/x@1/atoms/a.ts')).toBe(true)
    expect(isWatchedPath('.pwf/build-cache/abc.json')).toBe(false)
    expect(isWatchedPath('.pwf/out')).toBe(false)
    expect(isWatchedPath('.git/index')).toBe(false)
    expect(isWatchedPath('atoms/node_modules/x/y.js')).toBe(false)
    expect(isWatchedPath('')).toBe(true)
  })
})

describe('debounce', () => {
  it('fires once after the burst and can be cancelled', async () => {
    const fn = vi.fn()
    const d = debounce(fn, 30)
    d()
    d()
    d()
    await settle(80)
    expect(fn).toHaveBeenCalledTimes(1)
    d()
    d.cancel()
    d.cancel()
    await settle(60)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('watchFolder', () => {
  it('reports changed paths once per burst with native events', async () => {
    const root = await folder()
    const calls: (string[] | null)[] = []
    const w = watchFolder(root, (p) => calls.push(p), { mode: 'native', debounceMs: 80 })
    watchers.push(w)
    expect(w.mode).toBe('native')
    await settle(100)
    await writeFile(join(root, 'app', 'surfaces', 'home.receipt.json'), '{}')
    await writeFile(join(root, 'app', 'surfaces', 'home.receipt.json'), '{"a":1}')
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0), { timeout: 5000 })
    const seen = calls.flatMap((c) => c ?? [])
    expect(seen.some((p) => p.endsWith('home.receipt.json') || p === 'app/surfaces' || p === 'app')).toBe(true)
    expect(seen.every((p) => !p.includes('\\'))).toBe(true)

    // Output folders never trigger a build.
    const before = calls.length
    await mkdir(join(root, '.pwf', 'build-cache'), { recursive: true })
    await settle(200)
    const after = calls.length
    await writeFile(join(root, '.pwf', 'build-cache', 'k.json'), '{}')
    await settle(300)
    expect(calls.slice(after).flatMap((c) => c ?? []).filter((p) => p.startsWith('.pwf/build-cache/'))).toEqual([])
    expect(after).toBeGreaterThanOrEqual(before)
  })

  it('polls where native watching is not wanted', async () => {
    const root = await folder()
    await writeFile(join(root, 'app', 'a.json'), '1')
    const calls: (string[] | null)[] = []
    const w = watchFolder(root, (p) => calls.push(p), { mode: 'poll', pollMs: 50, debounceMs: 20 })
    watchers.push(w)
    expect(w.mode).toBe('poll')
    await settle(200)
    expect(calls).toEqual([])
    await writeFile(join(root, 'app', 'a.json'), '22')
    await vi.waitFor(() => expect(calls).toEqual([null]), { timeout: 5000 })
  })

  it('falls back to polling when native watching fails in auto mode', async () => {
    const missing = join(await folder(), 'not-there')
    const w = watchFolder(missing, () => undefined, { mode: 'auto', pollMs: 20 })
    watchers.push(w)
    expect(w.mode).toBe('poll')
    expect(() => watchFolder(missing, () => undefined, { mode: 'native' })).toThrow()
  })

  it('snapshots size and time of watched files only', async () => {
    const root = await folder()
    await writeFile(join(root, 'app', 'x.json'), 'x')
    await mkdir(join(root, '.pwf', 'out'), { recursive: true })
    await writeFile(join(root, '.pwf', 'out', 'index.html'), 'y')
    const snap = await snapshot(root)
    expect(snap).toContain('x.json|1|')
    expect(snap).not.toContain('index.html')
  })
})
