// @vitest-environment jsdom
/**
 * A source only a session can be answered for (`requiresSession`,
 * data-protocol §2.6). Signed out it is never asked — conference-companion
 * `#/today` asked `/records/Rsvp` for every visitor and got a 401 in the
 * console, which cost the page its best-practices score — and it binds the
 * refusal: no rows, `__errors.<id>` "unauthenticated". A sign-in asks it; a
 * sign-out settles it again without a request.
 *
 * @module @pwfabric/runtime/render/__tests__/requires-session.dom
 */
import '../../__tests__/dom-test-setup.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import type { Block } from '@pwfabric/core'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import type { BlockComponentRegistry } from '../types.js'
import type { SurfaceAuthHost } from '../data-binding-types.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const Text = ({ block, props }: { block: Block; props: Record<string, unknown> }) => (
  <div data-testid={block.id}>{String(props.text ?? '')}</div>
)
const components: Partial<BlockComponentRegistry> = { text: Text as never }

const surface = {
  id: 'today',
  blocks: [
    {
      id: 'out',
      type: 'text',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: { text: 'mine={{length(mine)}} error={{__errors.mine}} sessions={{length(sessions)}}' },
    },
  ],
  capabilities: [
    {
      capability: 'platform/persistence',
      config: {
        dataSources: [
          { id: 'mine', kind: 'rest', endpoint: '/api/records/Rsvp', returns: 'data', requiresSession: true },
          { id: 'sessions', kind: 'rest', endpoint: '/api/records/Session', returns: 'data' },
        ],
      },
    },
  ],
} as never

const host = (email: string | null): SurfaceAuthHost => ({
  state: {
    signedIn: email !== null,
    user: email === null ? null : { id: 'u1', name: 'Ada', email, roles: [] },
    methods: ['password'],
    registration: 'open',
    error: null,
  },
  onAction: vi.fn(),
})

function answering() {
  return vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ data: String(url).includes('Rsvp') ? [{ id: 'r1' }, { id: 'r2' }] : [{ id: 's1' }] }),
  }))
}

const asked = (fetch: ReturnType<typeof answering>, what: string): number =>
  fetch.mock.calls.filter(([url]) => String(url).includes(what)).length

describe('requiresSession', () => {
  it('signed out: not asked, refused as unauthenticated with no rows; the open source is asked', async () => {
    const fetch = answering()
    vi.stubGlobal('fetch', fetch as never)
    render(<DataBoundSurfaceRenderer surface={surface} components={components} identity={host(null)} />)
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('mine=0 error=unauthenticated sessions=1'))
    expect(asked(fetch, 'Rsvp')).toBe(0)
    expect(asked(fetch, 'Session')).toBe(1)
  })

  it('a sign-in asks it; a sign-out settles it again without a request', async () => {
    const fetch = answering()
    vi.stubGlobal('fetch', fetch as never)
    const view = render(<DataBoundSurfaceRenderer surface={surface} components={components} identity={host(null)} />)
    await waitFor(() => expect(screen.getByTestId('out').textContent).toContain('error=unauthenticated'))
    view.rerender(<DataBoundSurfaceRenderer surface={surface} components={components} identity={host('ada@x.io')} />)
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('mine=2 error= sessions=1'))
    expect(asked(fetch, 'Rsvp')).toBe(1)
    view.rerender(<DataBoundSurfaceRenderer surface={surface} components={components} identity={host(null)} />)
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('mine=0 error=unauthenticated sessions=1'))
    expect(asked(fetch, 'Rsvp')).toBe(1)
  })
})
