// @vitest-environment jsdom
/**
 * Thin-mode + public-API + capability-stub coverage.
 *
 * Exercises `loadThin` against a mocked fetch (no network), the `render`
 * dispatcher in both modes, the `data-pw-surface` auto-loader, and the
 * offline capability stubs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as React from 'react'
import { loadThin, grantsToDescriptors } from '../thin.js'
import { render, autoload } from '../index.js'
import {
  createOfflineEntityFacade,
  createOfflineNavigationProvider,
  staticPersistenceCapability,
} from '../capabilities-stub.js'
import type { BlockComponentProps } from '@pwfabric/runtime'
import type { RenderableSurface } from '@pwfabric/runtime'

const FULL_SPAN = { span: { xs: 4, sm: 8, md: 12, lg: 12 } }

function TextBlock({ props }: BlockComponentProps): React.ReactElement {
  return React.createElement('p', { 'data-testid': 'tb' }, String(props.content ?? ''))
}

function makeApiResponse() {
  return {
    data: {
      surfaceId: 'srf_1',
      worldId: 'wld_1',
      definition: {
        blocks: [{ id: 'b1', type: 'text', props: { content: 'Thin hello' }, layout: FULL_SPAN }],
        theme: { colors: { primary: '#123456' } },
        capabilities: [{ capability: 'platform/navigation' }],
      },
      layout: { maxWidth: 960, gap: 12, padding: 24 },
      renderGrants: [
        {
          surfaceId: 'srf_1',
          blockType: 'badge',
          artifactName: 'Badge',
          artifactVersion: '1.0.0',
          moduleUrl: 'https://cdn.example/badge.mjs',
          integrity: 'a'.repeat(64),
          expiresAt: Date.now() + 100000,
        },
      ],
    },
  }
}

let container: HTMLDivElement
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  container.remove()
  vi.restoreAllMocks()
})

describe('loadThin', () => {
  it('fetches by slug and normalises blocks, grants, theme, capabilities', async () => {
    const fetchImpl = vi.fn(async () =>
      ({ ok: true, status: 200, json: async () => makeApiResponse() }) as unknown as Response
    )
    const result = await loadThin(
      { tenantSlug: 'acme', surfaceSlug: 'home' },
      { apiBaseUrl: 'https://api.test', fetchImpl, auth: { accessToken: 'tok' } }
    )

    // Correct by-slug endpoint + bearer header.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.test/api/surfaces/by-slug/acme/home')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok')

    expect(result.surface.blocks).toHaveLength(1)
    expect(result.surface.id).toBe('srf_1')
    expect(result.worldId).toBe('wld_1')
    expect(result.layout?.maxWidth).toBe(960)
    // Render grant → descriptor (publisher 'workspace', unverified) — host parity.
    expect(result.dynamicBlocks).toHaveLength(1)
    expect(result.dynamicBlocks[0]).toMatchObject({
      blockType: 'badge',
      publisher: 'workspace',
      publisherVerified: false,
    })
    // Theme wrapped into an appearance ref. Config only — the `use` atom id
    // retired with the appearance engine.
    expect(result.surface.appearance).not.toHaveProperty('use')
  })

  it('builds the by-id /published endpoint', async () => {
    const fetchImpl = vi.fn(async () =>
      ({ ok: true, status: 200, json: async () => makeApiResponse() }) as unknown as Response
    )
    await loadThin({ surfaceId: 'srf_9' }, { apiBaseUrl: 'https://api.test/', fetchImpl })
    expect((fetchImpl.mock.calls[0] as [string])[0]).toBe(
      'https://api.test/api/surfaces/srf_9/published'
    )
  })

  it('throws on a non-OK response', async () => {
    const fetchImpl = vi.fn(async () =>
      ({ ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) }) as unknown as Response
    )
    await expect(
      loadThin({ surfaceId: 'x' }, { apiBaseUrl: 'https://api.test', fetchImpl })
    ).rejects.toThrow(/404/)
  })

  it('throws on a wrapped API error', async () => {
    const fetchImpl = vi.fn(async () =>
      ({ ok: true, status: 200, json: async () => ({ error: { code: 'FORBIDDEN' } }) }) as unknown as Response
    )
    await expect(
      loadThin({ surfaceId: 'x' }, { apiBaseUrl: 'https://api.test', fetchImpl })
    ).rejects.toThrow(/FORBIDDEN/)
  })

  it('grantsToDescriptors returns [] for no grants', () => {
    expect(grantsToDescriptors([])).toEqual([])
  })
})

describe('render() dispatcher', () => {
  it('thin mode mounts after fetching + calls onReady', async () => {
    const fetchImpl = vi.fn(async () =>
      ({ ok: true, status: 200, json: async () => makeApiResponse() }) as unknown as Response
    )
    const onReady = vi.fn()
    const handle = await render(
      container,
      { tenantSlug: 'acme', surfaceSlug: 'home' },
      { mode: 'thin', apiBaseUrl: 'https://api.test', fetchImpl, onReady }
    )
    expect(onReady).toHaveBeenCalledOnce()
    await new Promise((r) => setTimeout(r, 0))
    handle.unmount()
  })

  it('fat mode renders an inline surface', async () => {
    const surface = {
      id: 's',
      blocks: [{ id: 'b1', type: 'text', props: { content: 'inline' }, layout: FULL_SPAN }],
    } as unknown as RenderableSurface
    const handle = await render(
      container,
      { surface },
      { mode: 'fat', components: { text: TextBlock }, interactionMode: 'inert' }
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('[data-testid="tb"]')?.textContent).toBe('inline')
    handle.unmount()
  })

  it('thin mode without apiBaseUrl rejects and fires onError', async () => {
    const onError = vi.fn()
    await expect(
      render(container, { surfaceId: 'x' }, { mode: 'thin', onError })
    ).rejects.toThrow(/apiBaseUrl/)
    expect(onError).toHaveBeenCalledOnce()
  })

  it('fat mode with a non-inline source rejects', async () => {
    await expect(render(container, { surfaceId: 'x' }, { mode: 'fat' })).rejects.toThrow(
      /inline/
    )
  })
})

describe('autoload (data-pw-surface)', () => {
  it('hydrates an inline fat element from sibling scripts', async () => {
    const host = document.createElement('div')
    host.dataset.pwSurface = 'inline'
    host.dataset.pwMode = 'fat'
    const surfaceScript = document.createElement('script')
    surfaceScript.type = 'application/pw-surface+json'
    surfaceScript.textContent = JSON.stringify({
      id: 's2',
      blocks: [{ id: 'b1', type: 'text', props: { content: 'auto' }, layout: FULL_SPAN }],
    })
    host.appendChild(surfaceScript)
    container.appendChild(host)

    autoload(container)
    await new Promise((r) => setTimeout(r, 0))

    // Marked hydrated + a surface root was created.
    expect(host.dataset.pwHydrated).toBe('true')
    expect(host.querySelector('[data-pw-surface]')).not.toBeNull()
  })

  it('warns and skips a thin element missing data-pw-api', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = document.createElement('div')
    host.dataset.pwSurface = 'srf_x'
    container.appendChild(host)
    autoload(container)
    expect(warn).toHaveBeenCalled()
  })
})

describe('capability stubs', () => {
  it('createOfflineEntityFacade seeds in-memory records', async () => {
    const facade = createOfflineEntityFacade([
      {
        definition: {
          id: 'todo',
          name: 'Todo',
          primaryKey: 'id',
          fields: [{ name: 'title', type: 'string' }],
          // The registry only checks `schema` is truthy; a stub suffices here.
          schema: { parse: (v: unknown) => v },
        } as never,
        records: [{ title: 'a' }],
      },
    ])
    expect(facade.connectors.has('offline')).toBe(true)
  })

  it('createOfflineNavigationProvider resolves hrefs against basePath', () => {
    const nav = createOfflineNavigationProvider({ basePath: '/app' })
    const data = nav.data as { resolve: (h: string) => string; push: () => void }
    expect(data.resolve('/page')).toBe('/app/page')
    expect(data.resolve('#anchor')).toBe('#anchor')
    expect(data.resolve('https://x.com')).toBe('https://x.com')
    expect(() => data.push()).not.toThrow()
  })

  it('staticPersistenceCapability builds static data sources', () => {
    const cap = staticPersistenceCapability({ items: [1, 2, 3] }, { count: 3 })
    expect(cap.capability).toBe('platform/persistence')
    const cfg = cap.config as { dataSources: { id: string; kind: string }[]; initialState: unknown }
    expect(cfg.dataSources[0]).toMatchObject({ id: 'items', kind: 'static' })
    expect(cfg.initialState).toEqual({ count: 3 })
  })
})
