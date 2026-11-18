// @vitest-environment jsdom
/**
 * The app's words reach the blocks; the engine makes up no title or language.
 *
 * A block's own words (an accessible name, "Next page") read the app's
 * `messages` through `useAppMessage`; the render option `messages` is how a
 * host hands them over. A block prop still wins — the block decides that.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { renderFat } from '../fat.js'
import { buildFatHtml } from '../build-fat-html.js'
import type { RenderableSurface } from '@pwfabric/contracts'
import type { BlockComponentProps } from '@pwfabric/runtime'
import { useAppMessage } from '@pwfabric/runtime'

const FULL_SPAN = { span: { xs: 4, sm: 8, md: 12, lg: 12 } }

function surface(): RenderableSurface {
  return {
    id: 'srf_words',
    blocks: [
      { id: 'c', type: 'closer', props: {}, layout: FULL_SPAN },
      { id: 'p', type: 'closer', props: { closeLabel: 'Dismiss this' }, layout: FULL_SPAN },
      { id: 'n', type: 'pager', props: {}, layout: FULL_SPAN },
    ],
  } as unknown as RenderableSurface
}

function Closer({ block, props }: BlockComponentProps): React.ReactElement {
  const fallback = useAppMessage('ui.close', 'Close')
  const label = typeof props.closeLabel === 'string' && props.closeLabel ? props.closeLabel : fallback
  return <button data-testid={block.id} aria-label={label} />
}
function Pager({ block }: BlockComponentProps): React.ReactElement {
  return <span data-testid={block.id}>{useAppMessage('ui.pagination.page', 'Page {n}', { n: 3 })}</span>
}
const components = { closer: Closer, pager: Pager } as never

let target: HTMLElement
afterEach(() => target?.remove())

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) return
    await new Promise((r) => setTimeout(r, 5))
  }
}

function mount(options: Record<string, unknown>): void {
  target = document.createElement('div')
  document.body.appendChild(target)
  renderFat(target, { surface: surface(), components, ...options } as never)
}
const label = (id: string): string | null =>
  target.querySelector(`[data-testid="${id}"]`)?.getAttribute('aria-label') ?? null
const text = (id: string): string | null => target.querySelector(`[data-testid="${id}"]`)?.textContent ?? null

describe('useAppMessage through the render option `messages`', () => {
  it('reads the app’s message, fills its placeholders, and lets a block prop win', async () => {
    mount({ messages: { 'ui.close': 'Kapat', 'ui.pagination.page': 'Sayfa {n}' } })
    await waitFor(() => label('c') !== null)
    expect(label('c')).toBe('Kapat')
    expect(label('p')).toBe('Dismiss this')
    expect(text('n')).toBe('Sayfa 3')
  })

  it('reads the block’s neutral fallback when the app sets none', async () => {
    mount({})
    await waitFor(() => label('c') !== null)
    expect(label('c')).toBe('Close')
    expect(text('n')).toBe('Page 3')
  })
})

describe('buildFatHtml', () => {
  const base = { surface: { blocks: [] } as unknown as RenderableSurface, embedJs: '' }
  it('writes no title and no lang the app did not give', () => {
    const html = buildFatHtml(base)
    expect(html).toContain('<html>')
    expect(html).not.toContain('<title>')
    expect(html).not.toContain('Surface')
  })
  it('writes the app’s title and locale', () => {
    const html = buildFatHtml({ ...base, title: 'Manav <1>', lang: 'tr-TR' })
    expect(html).toContain('<html lang="tr-TR">')
    expect(html).toContain('<title>Manav &lt;1&gt;</title>')
  })
})
