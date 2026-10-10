/**
 * Surface Renderer Tests
 *
 * legacy first-party render assertions retired.
 * The 45 hardcoded `*Block` components are gone — production rendering
 * loads components from CDN bundles via `BlockModuleLoader` /
 * `DynamicBlockWrapper`, exercised in their dedicated test suites.
 * What remains here is the renderer's behaviour around unknown block
 * types and the surface utility helpers (`getBlockIds`, `findBlockById`,
 * `updateBlockById`).
 *
 * @module @pwfabric/runtime/render/__tests__/renderer
 */

import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import type { Block } from '@pwfabric/core'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import {
  SurfaceRenderer,
  BlockRenderer,
  getBlockIds,
  findBlockById,
  updateBlockById,
} from '../renderer.js'
import type { RenderableSurface } from '../types.js'

// ============================================================
// TEST FIXTURES
// ============================================================

const textBlock: Block = {
  id: 'text-1',
  type: 'text',
  layout: DEFAULT_BLOCK_LAYOUT,
  props: { content: 'Hello, World!' },
}

const containerWithChildren: Block = {
  id: 'container-1',
  type: 'container',
  layout: DEFAULT_BLOCK_LAYOUT,
  props: { direction: 'column' },
  children: [
    {
      id: 'heading-1',
      type: 'heading',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: { text: 'Welcome', level: 'h1' },
    },
    {
      id: 'text-2',
      type: 'text',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: { content: 'This is a paragraph.' },
    },
  ],
}

// ============================================================
// SURFACE RENDERER — unknown block + custom component map
// ============================================================

describe('SurfaceRenderer', () => {
  it('renders unregistered types without a visible placeholder (tagged for diagnostics)', () => {
    const surface: RenderableSurface = { blocks: [textBlock] }
    const html = renderToString(<SurfaceRenderer surface={surface} />)
    expect(html).not.toContain('Unknown block')
    expect(html).toContain('data-unknown-type="text"')
  })

  it('renders custom components supplied via the `components` prop', () => {
    const customComponents = {
      text: (({ props }: { props: Record<string, unknown> }) => (
        <p data-testid="custom-text">{String(props.content ?? '')}</p>
      )) as never,
    }
    const surface: RenderableSurface = { blocks: [textBlock] }
    const html = renderToString(<SurfaceRenderer surface={surface} components={customComponents} />)
    expect(html).toContain('Hello, World!')
    expect(html).toContain('data-testid="custom-text"')
  })
})

describe('BlockRenderer', () => {
  it('renders no visible placeholder for blocks without a descriptor or custom component', () => {
    const html = renderToString(<BlockRenderer block={textBlock} />)
    expect(html).not.toContain('Unknown block')
    expect(html).toContain('data-unknown-type="text"')
  })
})

// ============================================================
// SURFACE UTILITIES (block tree helpers)
// ============================================================

describe('getBlockIds', () => {
  it('should return all block IDs', () => {
    const ids = getBlockIds([containerWithChildren])
    expect(ids).toContain('container-1')
    expect(ids).toContain('heading-1')
    expect(ids).toContain('text-2')
    expect(ids).toHaveLength(3)
  })

  it('should return empty array for empty blocks', () => {
    expect(getBlockIds([])).toEqual([])
  })
})

describe('findBlockById', () => {
  it('should find block at root level', () => {
    const found = findBlockById([containerWithChildren], 'container-1')
    expect(found?.id).toBe('container-1')
  })

  it('should find nested block', () => {
    const found = findBlockById([containerWithChildren], 'heading-1')
    expect(found?.id).toBe('heading-1')
  })

  it('should return undefined for non-existent ID', () => {
    expect(findBlockById([containerWithChildren], 'nonexistent')).toBeUndefined()
  })
})

describe('updateBlockById', () => {
  it('should update block at root level', () => {
    const updated = updateBlockById([textBlock], 'text-1', { props: { content: 'Updated!' } })
    expect(updated[0]?.props?.content).toBe('Updated!')
  })

  it('should update nested block', () => {
    const updated = updateBlockById([containerWithChildren], 'heading-1', {
      props: { text: 'New Title' },
    })
    const heading = updated[0]?.children?.[0]
    expect(heading?.props?.text).toBe('New Title')
  })

  it('should not modify other blocks', () => {
    const updated = updateBlockById([containerWithChildren], 'heading-1', {
      props: { text: 'New Title' },
    })
    const text = updated[0]?.children?.[1]
    expect(text?.props?.content).toBe('This is a paragraph.')
  })
})
