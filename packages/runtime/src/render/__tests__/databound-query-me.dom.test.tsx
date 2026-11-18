// @vitest-environment jsdom
/**
 * E5 — a page finds the caller's own record: a source's query value may read
 * `{{me.*}}`. Signed out, such a source asks for nothing; a sign-in asks it
 * again with the visitor in it.
 *
 * @module @pwfabric/runtime/render/__tests__/databound-query-me.dom
 */
import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import type { Block } from '@pwfabric/core'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import type { BlockComponentRegistry } from '../types.js'
import type { SurfaceAuthHost, SurfaceAuthState } from '../data-binding-types.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const Text = ({ block, props }: { block: Block; props: Record<string, unknown> }) => (
  <div data-testid={block.id}>{String(props.text ?? '')}</div>
)
const components: Partial<BlockComponentRegistry> = { text: Text as never }

const MEMBERS = [
  { id: 'm1', email: 'bo@x.io', team: 'Ops' },
  { id: 'm2', email: 'ada@x.io', team: 'Web' },
]

const surface = {
  id: 'team',
  blocks: [{ id: 'out', type: 'text', layout: DEFAULT_BLOCK_LAYOUT, props: { text: 'team={{mine.0.team}} n={{length(mine)}}' } }],
  capabilities: [
    {
      capability: 'platform/persistence',
      config: {
        dataSources: [
          { id: 'mine', kind: 'rest', endpoint: '/api/members', query: { filter: { field: 'email', operator: 'eq', value: '{{me.email}}' } } },
        ],
      },
    },
  ],
} as never

const state = (email: string | null): SurfaceAuthState => ({
  signedIn: email !== null,
  user: email === null ? null : { id: 'u', name: 'Ada', email, roles: [] },
  methods: ['password'],
  registration: 'open',
  error: null,
})
const host = (email: string | null): SurfaceAuthHost => ({ state: state(email), onAction: vi.fn() })

describe('E5 {{me.*}} in a query value', () => {
  it('signed in, the query reads the visitor: their own row', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => MEMBERS }))
    vi.stubGlobal('fetch', fetch as never)
    render(<DataBoundSurfaceRenderer surface={surface} components={components} identity={host('ada@x.io')} />)
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('team=Web n=1'))
  })

  it('signed out it asks for nothing — never every row — and a sign-in asks again', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => MEMBERS }))
    vi.stubGlobal('fetch', fetch as never)
    const view = render(<DataBoundSurfaceRenderer surface={surface} components={components} identity={host(null)} />)
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('team= n=0'))
    expect(fetch).not.toHaveBeenCalled()
    view.rerender(<DataBoundSurfaceRenderer surface={surface} components={components} identity={host('bo@x.io')} />)
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('team=Ops n=1'))
    expect(fetch).toHaveBeenCalled()
  })
})
