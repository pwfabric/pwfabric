/**
 * Browser smoke test: the assembled page's module graph — renderer, shims
 * behind the import map, runner, compiled blocks — boots in a jsdom document
 * and renders the fixture page. The page is driven by `browser-smoke.mjs` in
 * a plain Node process; see that file for what it does by hand.
 */
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createDevServer } from '../../dev/server.js'
import type { DevServer } from '../../dev/types.js'
import { makeApp } from './helpers.js'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

const SMOKE = fileURLToPath(new URL('./browser-smoke.mjs', import.meta.url))

let server: DevServer
let cleanup: () => Promise<void>
beforeAll(async () => {
  const app = await makeApp()
  cleanup = app.cleanup
  server = await createDevServer({ root: app.root, port: 0 }, { watch: false })
})
afterAll(async () => {
  await server?.close()
  await cleanup?.()
})

describe('the assembled page in a document', () => {
  it('boots the runner and renders the page with the compiled blocks', async () => {
    const { stdout } = await promisify(execFile)(process.execPath, [SMOKE, server.url], { timeout: 60_000 })
    const result = JSON.parse(stdout.trim().split('\n').pop() as string) as Record<string, unknown>
    expect(result['renderer']).toBe('function')
    expect(result['seeded']).toEqual([
      '__pwfabric_react',
      '__pwfabric_jsx_runtime',
      '__pwfabric_zod',
      '__pwfabric_runtime',
      '__pwfabric_contracts',
      '__pwfabric_react_dom',
      '__pwfabric_core',
      '__pwfabric_sdk',
    ])
    const values = result['values'] as { defineBlock: string; coreExports: number }
    expect(values.defineBlock).toBe('function')
    expect(values.coreExports).toBeGreaterThan(10)
    expect(result['heading']).toBe('Hello from k-app')
    expect(result['stack']).toBe(true)
    expect(result['title']).toBe('K Demo — Home')
    expect(result['errors']).toEqual([])
  })
})
