// @vitest-environment jsdom
/**
 * Offline render proof.
 *
 * Mounts a tiny surface fully offline through the REAL SurfaceRenderer (via
 * the embed `renderFat` path) and asserts the resulting DOM. This proves the
 * end-to-end offline render works with the real runtime renderer — no API, no
 * network, no live capabilities.
 *
 * Two paths are exercised:
 *   1. A `text` block rendered via a static component override (no bundle) —
 *      the minimal proof the renderer mounts and walks the block tree.
 *   2. A dynamic block whose `moduleUrl` is an inline `data:` ESM module,
 *      hash-verified against `descriptor.integrity` by the runtime's
 *      BlockModuleLoader — the proof that inline/offline bundle loading works.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderFat } from '../fat.js'
import { buildFatHtml } from '../build-fat-html.js'
import { needsDataBoundRenderer } from '../render-core.js'
import type { RenderableSurface } from '@pwfabric/contracts'
import type { BlockComponentProps } from '@pwfabric/runtime'

// ------------------------------------------------------------
// helpers
// ------------------------------------------------------------

const FULL_SPAN = { span: { xs: 4, sm: 8, md: 12, lg: 12 } }

function textSurface(): RenderableSurface {
  return {
    id: 'srf_test',
    blocks: [
      {
        id: 'b1',
        type: 'text',
        props: { content: 'Hello offline' },
        layout: FULL_SPAN,
      },
    ],
  } as unknown as RenderableSurface
}

// A trivial static component standing in for an installed `text` block.
function TextBlock({ props }: BlockComponentProps): React.ReactElement {
  return React.createElement('p', { 'data-testid': 'text-block' }, String(props.content ?? ''))
}

import * as React from 'react'

// SHA-256 hex of a string, using the same WebCrypto API the loader uses.
async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ------------------------------------------------------------
// DOM lifecycle
// ------------------------------------------------------------

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  container.id = 'pw-root'
  document.body.appendChild(container)
})

afterEach(() => {
  container.remove()
})

// ------------------------------------------------------------
// tests
// ------------------------------------------------------------

describe('renderFat — offline render with the real SurfaceRenderer', () => {
  it('renders a text block via a static component override into the DOM', async () => {
    const handle = renderFat(container, {
      surface: textSurface(),
      components: { text: TextBlock },
      interactionMode: 'inert',
    })

    // React 19 createRoot renders synchronously enough that the node is present
    // after a microtask flush.
    await new Promise((r) => setTimeout(r, 0))

    const surfaceRoot = container.querySelector('[data-pw-surface]')
    expect(surfaceRoot).not.toBeNull()

    const textNode = container.querySelector('[data-testid="text-block"]')
    expect(textNode?.textContent).toBe('Hello offline')

    // The block wrapper carries the unified per-block selector.
    expect(container.querySelector('[data-block-id="b1"]')).not.toBeNull()

    handle.unmount()
  })

  it('loads a dynamic block from an inline data: ESM module (integrity-verified)', async () => {
    // A self-contained ESM module exporting the wrapper convention.
    const moduleSource = [
      "import { createElement } from 'react'",
      'export function Component(props) {',
      "  return createElement('span', { 'data-testid': 'dyn-block' }, 'dynamic offline')",
      '}',
      "export const definition = { name: 'badge', canHaveChildren: false }",
    ].join('\n')

    const integrity = await sha256Hex(moduleSource)
    const moduleUrl = `data:text/javascript;base64,${btoa(moduleSource)}`

    const surface = {
      id: 'srf_dyn',
      blocks: [{ id: 'd1', type: 'badge', props: {}, layout: FULL_SPAN }],
    } as unknown as RenderableSurface

    const handle = renderFat(container, {
      surface,
      blocks: [
        {
          blockType: 'badge',
          moduleUrl,
          integrity,
          publisher: 'workspace',
          publisherVerified: false,
          definition: { name: 'badge', category: 'marketplace', defaultProps: {}, canHaveChildren: false },
        },
      ],
      interactionMode: 'inert',
    })

    // The loader fetches + hash-verifies + dynamic-imports the blob; give the
    // async pipeline a few ticks to settle.
    await new Promise((r) => setTimeout(r, 50))

    expect(container.querySelector('[data-dynamic-block="badge"]')).not.toBeNull()

    handle.unmount()
  })
})

describe('buildFatHtml — self-contained artifact', () => {
  it('inlines surface JSON, blocks, appearance, embed.js, and the bootstrap', () => {
    const html = buildFatHtml({
      surface: textSurface(),
      blocks: [],
      embedJs: 'window.__EMBED_STUB__=1;',
    })

    expect(html).toContain('<div id="pw-root">')
    expect(html).toContain('application/pw-surface+json')
    expect(html).toContain('application/pw-blocks+json')
    expect(html).toContain('application/pw-appearance+json')
    expect(html).toContain('window.__EMBED_STUB__=1;')
    expect(html).toContain("PWFabric.render('#pw-root'")
    // The surface id must survive serialization.
    expect(html).toContain('srf_test')
  })

  it('escapes < and > inside the inlined JSON so a malicious </script> cannot break out', () => {
    const surface = {
      id: 'srf_xss',
      blocks: [{ id: 'b', type: 'text', props: { content: '</script><script>alert(1)</script>' }, layout: FULL_SPAN }],
    } as unknown as RenderableSurface
    const html = buildFatHtml({ surface, embedJs: '' })
    // The payload script's text must NOT contain a raw closing </script>.
    const payload = html.split('application/pw-surface+json">')[1]?.split('</script>')[0] ?? ''
    expect(payload).not.toContain('<')
    expect(payload).not.toContain('>')
    expect(payload).toContain('\\u003c')
  })
})

describe('needsDataBoundRenderer', () => {
  it('is false for a plain surface', () => {
    expect(needsDataBoundRenderer(textSurface())).toBe(false)
  })

  it('is true when platform/persistence declares data sources', () => {
    const surface = {
      blocks: [],
      capabilities: [
        {
          capability: 'platform/persistence',
          required: false,
          config: { dataSources: [{ id: 's', kind: 'static', staticData: [] }] },
        },
      ],
    } as unknown as RenderableSurface
    expect(needsDataBoundRenderer(surface)).toBe(true)
  })

  // embed and the renderer answer from ONE predicate.
  it('is true for a page whose only dynamic part is a button action', () => {
    const surface = {
      blocks: [{ id: 'b', type: 'button', props: { action: { type: 'setState', key: 'step', value: 2 } } }],
    } as unknown as RenderableSurface
    expect(needsDataBoundRenderer(surface)).toBe(true)
  })

  it('is true for a formBindings-only page', () => {
    const surface = {
      blocks: [],
      capabilities: [{ capability: 'platform/entities', config: { formBindings: [{ formId: 'f', sourceId: 's' }] } }],
    } as unknown as RenderableSurface
    expect(needsDataBoundRenderer(surface)).toBe(true)
  })
})
