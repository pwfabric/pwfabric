// @vitest-environment jsdom
/**
 * A pack block renders with its manifest's declarations applied (3.0).
 *
 * The manifest is the block's only definition of its props: the descriptor
 * the host hands the renderer carries them (`definition.props`), and
 * `DynamicBlockWrapper` fills defaults, coerces and replaces a value that does
 * not fit before the block sees its props. A bad prop never throws; under
 * `pwf dev` it is a warning, for a visitor it is silent.
 */

import '../../__tests__/dom-test-setup.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import type { DynamicBlockDescriptor } from '@pwfabric/contracts'
import type { BlockComponent } from '../types.js'

const seen: Record<string, unknown>[] = []
const Badge: BlockComponent = ({ props }) => {
  seen.push(props as Record<string, unknown>)
  return <span data-testid="badge">{`${String(props['text'])}|${String(props['size'])}|${String(props['gap'])}`}</span>
}

vi.mock('../dynamic-block-loader.js', () => ({
  BlockModuleLoader: {
    preload: vi.fn(),
    load: vi.fn(async () => Badge),
    isLoaded: vi.fn().mockReturnValue(true),
    getSync: vi.fn(() => Badge),
    invalidate: vi.fn(),
  },
}))

const { DynamicBlockWrapper } = await import('../DynamicBlockWrapper.js')

const descriptor: DynamicBlockDescriptor = {
  blockType: 'badge',
  moduleUrl: 'blocks/badge.mjs',
  integrity: 'sha256-x',
  publisher: 'test',
  publisherVerified: true,
  definition: {
    name: 'badge',
    props: [
      { name: 'text', default: '', jsonSchema: { type: 'string' } },
      { name: 'size', default: 'md', jsonSchema: { type: 'string', enum: ['sm', 'md', 'lg'] } },
      { name: 'gap', default: 8, jsonSchema: { type: 'number', minimum: 0 } },
    ],
  },
}

const context = { viewport: 'lg' } as never

afterEach(() => {
  cleanup()
  seen.length = 0
  delete (globalThis as { __pwfabric_dev?: unknown }).__pwfabric_dev
  vi.restoreAllMocks()
})

describe('DynamicBlockWrapper applies the manifest props', () => {
  it('fills the declared defaults the receipt leaves out', () => {
    render(<DynamicBlockWrapper descriptor={descriptor} block={{ id: 'b', type: 'badge', props: { text: 'New' } } as never} context={context} />)
    expect(screen.getByTestId('badge').textContent).toBe('New|md|8')
  })

  it('a block with no props key still gets its defaults (never undefined props)', () => {
    render(<DynamicBlockWrapper descriptor={descriptor} block={{ id: 'b', type: 'badge' } as never} context={context} />)
    expect(screen.getByTestId('badge').textContent).toBe('|md|8')
  })

  it('coerces and replaces values that do not fit — no throw, silent for a visitor', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(
      <DynamicBlockWrapper
        descriptor={descriptor}
        block={{ id: 'b', type: 'badge', props: { text: 3, size: 'huge', gap: '12' } } as never}
        context={context}
      />
    )
    expect(screen.getByTestId('badge').textContent).toBe('3|md|12')
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns once per problem under pwf dev', () => {
    ;(globalThis as { __pwfabric_dev?: unknown }).__pwfabric_dev = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const block = { id: 'b', type: 'badge', props: { size: 'enormous' } } as never
    render(<DynamicBlockWrapper descriptor={descriptor} block={block} context={context} />)
    render(<DynamicBlockWrapper descriptor={descriptor} block={{ id: 'c', type: 'badge', props: { size: 'enormous' } } as never} context={context} />)
    const ours = warn.mock.calls.filter((c) => String(c[0]).includes('block "badge"'))
    expect(ours).toHaveLength(1)
    expect(String(ours[0]?.[0])).toContain('size')
  })

  it('renders the same on the server as in the browser (a pre-rendered page hydrates)', () => {
    const block = { id: 'b', type: 'badge', props: { text: 'A' } } as never
    const html = renderToString(<DynamicBlockWrapper descriptor={descriptor} block={block} context={context} />)
    expect(html).toContain('A|md|8')
  })
})
