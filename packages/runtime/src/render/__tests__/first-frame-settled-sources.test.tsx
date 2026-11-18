/**
 * THE FIRST FRAME SETTLES WHAT NEEDS NO REQUEST (pwapp-format §2.5).
 *
 * The build's static paint and the browser's first render are one render of
 * the page before any effect has run. A source the runtime settles WITHOUT a
 * request must be settled there already, or the build paints a spinner that
 * the first pass redraws:
 *
 *  - an idle source (an empty record key asks for no record, data-protocol
 *    §1.1): headphone-shop `#/confirmation` with no `?id=` painted its
 *    loading spinner, then hydration redrew it as "No order to confirm";
 *  - a `requiresSession` source while nobody is signed in (data-protocol
 *    §2.6): never asked, settled as the refusal it would get —
 *    `__errors.<id>` "unauthenticated", no rows.
 *
 * @module @pwfabric/runtime/render/__tests__/first-frame-settled-sources
 */
import { describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import type { BlockComponentRegistry } from '../types.js'
import type { SurfaceAuthHost } from '../data-binding-types.js'

const Text = ({ props }: { props: Record<string, unknown> }) => <p>{String(props.content ?? '')}</p>
const components: Partial<BlockComponentRegistry> = { text: Text as never }

const signedOut: SurfaceAuthHost = {
  state: { signedIn: false, user: null, methods: ['password'], registration: 'open', error: null },
  onAction: () => undefined,
}

function html(source: Record<string, unknown>, identity?: SurfaceAuthHost): string {
  const surface = {
    id: 'p',
    blocks: [
      {
        id: 't',
        type: 'text',
        layout: DEFAULT_BLOCK_LAYOUT,
        props: { content: 'loading={{__loading.s}}|idle={{__idle.s}}|error={{__errors.s}}|code={{__errorCodes.s}}|rows={{length(s)}}' },
      },
    ],
    capabilities: [{ capability: 'platform/persistence', config: { dataSources: [source], initialState: { id: '' } } }],
  } as never
  return renderToString(
    <DataBoundSurfaceRenderer
      surface={surface}
      components={components}
      loadingStrategy="immediate"
      {...(identity ? { identity } : {})}
    />
  )
}

describe('the first frame of a source settled without a request', () => {
  it('an idle record source is idle in the first frame, not loading (confirmation with no ?id=)', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    try {
      const out = html({ id: 's', kind: 'entity', entityType: 'Order', query: { filter: { field: 'id', operator: 'eq', value: '{{state.id}}' } } })
      expect(out).toContain('loading=false|idle=true')
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a source that is asked is loading in the first frame', () => {
    expect(html({ id: 's', kind: 'rest', endpoint: '/api/orders' })).toContain('loading=true|idle=false')
  })

  it('signed out, a requiresSession source is refused in the first frame: unauthenticated, no rows', () => {
    const out = html({ id: 's', kind: 'rest', endpoint: '/api/records/Rsvp', requiresSession: true }, signedOut)
    expect(out).toContain('loading=false|idle=false|error=unauthenticated|code=401|rows=0')
  })

  it('with no identity host a requiresSession source is asked as written (an editor, a pack gallery)', () => {
    expect(html({ id: 's', kind: 'rest', endpoint: '/api/records/Rsvp', requiresSession: true })).toContain('loading=true')
  })
})

describe('the first frame of a record page (notFoundWhenEmpty)', () => {
  it('its record, idle for want of an id, is drawn loading: that page is replaced by the not-found page, and its frame is every record’s', () => {
    const source = { id: 's', kind: 'entity', entityType: 'Product', notFoundWhenEmpty: true, query: { filter: { field: 'id', operator: 'eq', value: '{{state.id}}' } } }
    expect(html(source)).toContain('loading=true|idle=false')
  })
})
