// @vitest-environment jsdom
/**
 * renderFat — `loadingStrategy` and `dataCache` reach the data-bound renderer.
 *
 * A published app renders through `PWFabric.render` in fat mode. Both options
 * exist on the runtime renderer; without a passthrough here the runner could
 * not ask for them and every page change sat behind "Loading data...".
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderFat } from '../fat.js'
import type { RenderableSurface } from '@pwfabric/contracts'
import type { BlockComponentProps } from '@pwfabric/runtime'
import { dataSourceCacheKey } from '@pwfabric/runtime'

const FULL_SPAN = { span: { xs: 4, sm: 8, md: 12, lg: 12 } }
const SOURCE = { id: 'articles', kind: 'entity', entityType: 'Article' } as const

function boundSurface(): RenderableSurface {
  return {
    id: 'srf_bound',
    blocks: [
      { id: 'h', type: 'text', props: { content: 'STATIC CHROME' }, layout: FULL_SPAN },
      { id: 't', type: 'table', props: { data: '{{articles}}' }, layout: FULL_SPAN },
    ],
    capabilities: [{ capability: 'platform/persistence', config: { dataSources: [SOURCE] } }],
  } as unknown as RenderableSurface
}

const components = {
  text: ({ props }: BlockComponentProps) => <p>{String(props.content ?? '')}</p>,
  table: ({ props }: BlockComponentProps) => (
    <div data-testid="rows">
      {Array.isArray(props.data) ? props.data.map((r) => String((r as { id: unknown }).id)).join(',') : ''}
    </div>
  ),
} as never

const neverAnswering = { resolveBinding: vi.fn(() => new Promise(() => undefined)) } as never

let target: HTMLElement
afterEach(() => target?.remove())

/**
 * Wait for the CONDITION, not for the clock.
 *
 * A flat sleep (say 30 ms) before asserting is plenty on a developer's
 * machine and not enough in CI under coverage instrumentation, where React
 * may not have committed yet — a test that fails there while passing locally
 * accuses whatever change is in front of it.
 *
 * On timeout this RETURNS rather than throwing, so the test's own `expect`
 * still runs and reports what was actually in the DOM. A helper that threw
 * first would replace a useful diagnostic with "timed out".
 */
async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) return
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe('renderFat — loading passthrough', () => {
  it("'immediate' shows the static chrome before any source answers", async () => {
    target = document.createElement('div')
    document.body.appendChild(target)
    renderFat(target, {
      surface: boundSurface(),
      components,
      entityFacade: neverAnswering,
      loadingStrategy: 'immediate',
    })
    await waitFor(() => (target.textContent ?? '').includes('STATIC CHROME'))
    expect(target.textContent).toContain('STATIC CHROME')
    expect(target.querySelector('[data-surface-loading]')).toBeNull()
  })

  it('the default still gates, so existing consumers are unchanged', async () => {
    target = document.createElement('div')
    document.body.appendChild(target)
    renderFat(target, { surface: boundSurface(), components, entityFacade: neverAnswering })
    await waitFor(() => target.querySelector('[data-surface-loading]') !== null)
    expect(target.querySelector('[data-surface-loading]')).not.toBeNull()
  })

  it('a dataCache seeds the bound block on the first frame', async () => {
    target = document.createElement('div')
    document.body.appendChild(target)
    const key = dataSourceCacheKey(SOURCE, {})!
    const store = new Map<string, unknown>([[key, [{ id: 'cached-1' }]]])
    renderFat(target, {
      surface: boundSurface(),
      components,
      entityFacade: neverAnswering,
      loadingStrategy: 'immediate',
      dataCache: { get: (k) => store.get(k), set: (k, v) => void store.set(k, v) },
    })
    await waitFor(() => target.querySelector('[data-testid="rows"]')?.textContent === 'cached-1')
    expect(target.querySelector('[data-testid="rows"]')?.textContent).toBe('cached-1')
  })
})
