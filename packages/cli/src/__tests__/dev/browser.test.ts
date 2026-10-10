/**
 * Browser smoke test: the assembled page's module graph — renderer, shims
 * behind the import map, runner, compiled blocks — boots in a jsdom document
 * and renders the fixture page. The page is driven by `browser-smoke.mjs` in
 * a plain Node process; see that file for what it does by hand.
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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

/**
 * The documented authoring path, on a page that only runs the renderer and
 * the runner — no `seed.js`, as a published app's host gives it. The block
 * imports `defineBlock` from `@pwfabric/authoring` and exports nothing but
 * the definition it returns, the way the quickstart writes one.
 */
const QUOTE_BLOCK = `import { defineBlock } from '@pwfabric/authoring'
import { z } from 'zod'

export const QuoteCard = defineBlock({
  type: 'quote-card',
  name: 'Quote card',
  category: 'text',
  schema: z.object({ quote: z.string() }),
  defaultProps: { quote: 'A great product to work with.' },
  component: ({ props }) => <blockquote data-k="quote">{props.quote}</blockquote>,
})
`

const QUOTE_MANIFEST = {
  id: 'custom.quote-card',
  kind: 'block',
  version: '1.0.0',
  category: 'custom',
  name: 'quote-card',
  state: 'stable',
  knowledge: { purpose: 'Quotes a customer', useCases: [], composesWith: [], antiPatterns: [] },
  definition: {
    props: [{ name: 'quote', type: 'string', required: false, default: 'A great product to work with.', bindable: true }],
    defaultProps: { quote: 'A great product to work with.' },
    canHaveChildren: false,
    traits: [],
  },
}

describe('a defineBlock() block under the renderer and the runner alone', () => {
  let sdkServer: DevServer
  let sdkCleanup: () => Promise<void>
  beforeAll(async () => {
    const app = await makeApp()
    sdkCleanup = app.cleanup
    const dir = join(app.root, 'atoms', 'blocks', 'custom', 'quote-card')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'component.tsx'), QUOTE_BLOCK)
    await writeFile(join(dir, 'manifest.json'), `${JSON.stringify(QUOTE_MANIFEST, null, 2)}\n`)
    const receiptPath = join(app.root, 'app', 'surfaces', 'home.receipt.json')
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as { blocks: { children: unknown[] }[] }
    receipt.blocks[0]?.children.push({ id: 'quote', type: 'quote-card', props: { quote: 'It just rendered.' } })
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
    sdkServer = await createDevServer({ root: app.root, port: 0 }, { watch: false })
  })
  afterAll(async () => {
    await sdkServer?.close()
    await sdkCleanup?.()
  })

  it('renders: the renderer seeds the authoring kit and the block resolves its component from the definition', async () => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [SMOKE, sdkServer.url, '--no-seed', '--expect', '[data-k="quote"]'],
      { timeout: 60_000 }
    )
    const result = JSON.parse(stdout.trim().split('\n').pop() as string) as Record<string, unknown>
    expect(result['seeded']).toContain('__pwfabric_sdk')
    expect((result['values'] as { defineBlock: string }).defineBlock).toBe('function')
    expect(result['heading']).toBe('Hello from k-app')
    expect(result['expected']).toBe('It just rendered.')
    expect(result['errors']).toEqual([])
  })
})
