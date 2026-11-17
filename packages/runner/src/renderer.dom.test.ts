/**
 * @vitest-environment jsdom
 *
 * The runner loads the renderer itself, when it first draws a page — so the
 * shell names no render-blocking `embed.js`, and a visitor held at the
 * sign-in gate never downloads it.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadRenderer, resetRendererLoad } from './renderer.js'
import type { PWFabricGlobal } from './types.js'

const win = window as unknown as { PWFabric?: PWFabricGlobal }
const fake: PWFabricGlobal = { render: () => undefined, loadBlocks: async () => undefined }

afterEach(() => {
  delete win.PWFabric
  resetRendererLoad()
  for (const s of document.head.querySelectorAll('script')) s.remove()
})

describe('loadRenderer', () => {
  it('keeps a renderer the page already has, adding nothing', async () => {
    win.PWFabric = fake
    await expect(loadRenderer('./assets/embed.js')).resolves.toBe(fake)
    expect(document.head.querySelectorAll('script')).toHaveLength(0)
  })

  it('adds the script once, however often it is asked, and resolves with what it defines', async () => {
    const a = loadRenderer('./assets/embed.abc.js')
    const b = loadRenderer('./assets/embed.abc.js')
    const scripts = document.head.querySelectorAll('script')
    expect(scripts).toHaveLength(1)
    expect(scripts[0]?.getAttribute('src')).toBe('./assets/embed.abc.js')
    win.PWFabric = fake
    scripts[0]?.dispatchEvent(new Event('load'))
    await expect(a).resolves.toBe(fake)
    await expect(b).resolves.toBe(fake)
  })

  it('waits for the renderer the shell already names, rather than adding a second', async () => {
    const named = document.createElement('script')
    named.src = './assets/embed.abc.js'
    named.async = true
    document.head.appendChild(named)
    const p = loadRenderer('./assets/embed.abc.js')
    expect(document.head.querySelectorAll('script')).toHaveLength(1)
    win.PWFabric = fake
    named.dispatchEvent(new Event('load'))
    await expect(p).resolves.toBe(fake)
  })

  it('rejects when the script fails, and tries again on the next call', async () => {
    const first = loadRenderer('./assets/embed.js')
    document.head.querySelector('script')?.dispatchEvent(new Event('error'))
    await expect(first).rejects.toThrow(/could not be loaded/)
    void loadRenderer('./assets/embed.js').catch(() => undefined)
    // The failed element is gone; a fresh one is asking.
    expect(document.head.querySelectorAll('script')).toHaveLength(1)
  })

  it('rejects when the script loads but defines no renderer', async () => {
    const p = loadRenderer('./assets/embed.js')
    document.head.querySelector('script')?.dispatchEvent(new Event('load'))
    await expect(p).rejects.toThrow(/no window.PWFabric/)
  })
})

/**
 * runner.js runs before the renderer, so it may not import at load time a
 * module the import map serves from a global the renderer seeds: the shim
 * would throw and take the whole runner with it. Types are erased; a value
 * comes in through `await import(…)` once the renderer is in.
 */
describe('runner.js imports nothing the renderer seeds', () => {
  const SEEDED = /^(react|react\/jsx-runtime|react-dom|react-dom\/client|zod|@pwfabric\/runtime|@pwfabric\/runtime\/(data|capability|adapters|auth)|@pwfabric\/contracts|@pwfabric\/core|@pwfabric\/authoring)$/
  // vitest runs from the package folder.
  const dir = join(process.cwd(), 'src')
  const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'))

  it.each(sources)('%s', (file) => {
    const code = readFileSync(join(dir, file), 'utf8')
    const statics = [...code.matchAll(/^\s*(import|export)\s+(?!type\b)[^;'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[2])
    const sideEffects = [...code.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])
    expect([...statics, ...sideEffects].filter((s) => SEEDED.test(s ?? ''))).toEqual([])
  })
})
