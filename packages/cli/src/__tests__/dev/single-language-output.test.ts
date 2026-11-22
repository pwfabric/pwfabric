/**
 * A single-language app builds exactly as it did before apps could have
 * several languages: every file of the build, byte for byte, under hash and
 * path routing. The snapshot holds each file's SHA-256, taken from the build
 * before locales existed; the runtime's own scripts (`assets/*.js`, the
 * shims) are left out, and their content-hashed names normalised, because
 * they change with every engine release.
 *
 * Write the snapshot again (only when an intended change of the output is
 * made) with `PWF_WRITE_SNAPSHOT=1`.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assemblePwapp } from '../../dev/assemble.js'
import { makeApp } from './helpers.js'

vi.setConfig({ testTimeout: 90_000 })

const SNAPSHOT = fileURLToPath(new URL('../../__fixtures__/single-language-build.json', import.meta.url))

let cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()))
  cleanups = []
})

const page = (title: string, words: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ title, blocks: [{ id: 'page', type: 'stack', props: {}, children: [{ id: 't', type: 'title', props: { text: words } }] }], ...extra })

/** The k-app with three pages, a not-found page, an origin, words and a layout. */
async function example(): Promise<string> {
  const a = await makeApp()
  cleanups.push(a.cleanup)
  const root = a.root
  const surfaces = join(root, 'app', 'surfaces')
  await writeFile(join(surfaces, 'pricing.receipt.json'), page('Pricing', 'Plans and prices', { description: 'What it costs.' }))
  await writeFile(join(surfaces, 'docs.intro.receipt.json'), page('Intro', 'Read me first'))
  await writeFile(join(surfaces, 'missing.receipt.json'), page('Not here', 'Nothing at this address'))
  await writeFile(
    join(root, 'app', 'layout.receipt.json'),
    JSON.stringify({ blocks: [{ id: 'frame', type: 'stack', props: { gap: '4px' }, children: [{ id: 'brand', type: 'title', props: { text: 'K' } }, { type: 'pw:page' }] }] })
  )
  const identity = JSON.parse(await readFile(join(root, 'pwpack.json'), 'utf8')) as { app: Record<string, unknown> }
  identity.app = { ...identity.app, surfaceOrder: ['home', 'pricing', 'docs.intro'], notFound: 'missing' }
  await writeFile(join(root, 'pwpack.json'), JSON.stringify(identity))
  const planPath = join(root, 'app', 'plan.json')
  const plan = JSON.parse(await readFile(planPath, 'utf8')) as Record<string, unknown>
  await writeFile(
    planPath,
    JSON.stringify({
      ...plan,
      description: 'A demo app.',
      origin: 'https://k.example.com',
      locale: 'en-GB',
      titleTemplate: '%s · K Demo',
      messages: { 'notFound.title': 'Not found', 'ui.retry': '{n, plural, one {# try} other {# tries}}' },
    })
  )
  return root
}

/** Each file's SHA-256, without the runtime's own scripts and with their hashed names normalised. */
function fingerprint(files: ReadonlyMap<string, Uint8Array>): Record<string, string> {
  const runtimeName = /assets\/(embed|runner|boot|static)\.[0-9a-f]{8}\.js/g
  const out: Record<string, string> = {}
  for (const [path, bytes] of [...files].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    if (/^assets\/.*\.js$/.test(path) || path.startsWith('shims/')) continue
    const text = new TextDecoder().decode(bytes)
    const body = /\.(html|json|txt|xml|css|js|mjs)$/.test(path) || path === '_headers' ? text.replace(runtimeName, 'assets/$1.HASH.js') : text
    out[path] = createHash('sha256').update(body).digest('hex')
  }
  return out
}

describe('a single-language app builds as before', () => {
  for (const router of ['hash', 'path'] as const) {
    it(`writes the same files under ${router} routing`, async () => {
      const r = await assemblePwapp(await example(), { cacheDir: null, router, publishedAt: '2026-01-01T00:00:00.000Z' })
      expect(r.ok, r.diagnostics.map((d) => `${d.code} ${d.message}`).join('\n')).toBe(true)
      const got = fingerprint(r.files)
      const all = existsSync(SNAPSHOT) ? (JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Record<string, Record<string, string>>) : {}
      if (process.env['PWF_WRITE_SNAPSHOT'] === '1') {
        all[router] = got
        writeFileSync(SNAPSHOT, `${JSON.stringify(all, null, 2)}\n`)
      }
      expect(got).toEqual(all[router])
    })
  }
})
