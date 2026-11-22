// @vitest-environment jsdom
/**
 * The visitor's consent on every block's context (envelope §2.2):
 * `consentCategories`, `consent` and `setConsent`, from the host's store,
 * through the data-bound renderer — `{}` in a page rendered outside a
 * browser, the store's answers in the browser, re-read when they change.
 */
import '../../__tests__/dom-test-setup.js'
import { afterEach, describe, expect, it } from 'vitest'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { act, cleanup, render, screen } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import type { Block } from '@pwfabric/core'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import type { BlockComponentRegistry, BlockContext, ConsentStore } from '../types.js'

afterEach(cleanup)

function store(initial: Record<string, boolean>): ConsentStore {
  let answers: Readonly<Record<string, boolean>> = initial
  const listeners = new Set<() => void>()
  return {
    categories: ['analytics', 'support'],
    answers: () => answers,
    set(next) {
      answers = { ...answers, ...next }
      for (const l of listeners) l()
    },
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}

const Banner = ({ block, context }: { block: Block; context: BlockContext }) => (
  <div>
    <span data-testid={block.id}>{`${(context.consentCategories ?? []).join(',')}|${JSON.stringify(context.consent)}`}</span>
    <button type="button" data-testid="accept" onClick={() => context.setConsent?.({ analytics: true })}>
      accept
    </button>
  </div>
)
const components = { banner: Banner } as unknown as BlockComponentRegistry
const surface = { id: 's', blocks: [{ id: 'b', type: 'banner', props: {}, layout: DEFAULT_BLOCK_LAYOUT }] }

describe('context.consent', () => {
  it('is the store’s answers in the browser, and follows setConsent', async () => {
    const consent = store({ support: false })
    render(<DataBoundSurfaceRenderer surface={surface as never} components={components} consent={consent} />)
    expect(screen.getByTestId('b').textContent).toBe('analytics,support|{"support":false}')
    await act(async () => screen.getByTestId('accept').click())
    expect(screen.getByTestId('b').textContent).toBe('analytics,support|{"support":false,"analytics":true}')
  })

  it('is {} in a page rendered outside a browser: the build knows no visitor', () => {
    const html = renderToString(<DataBoundSurfaceRenderer surface={surface as never} components={components} consent={store({ analytics: true })} />)
    expect(html).toContain('analytics,support|{}')
  })

  it('is empty without a store, and setConsent does nothing', async () => {
    render(<DataBoundSurfaceRenderer surface={surface as never} components={components} />)
    expect(screen.getByTestId('b').textContent).toBe('|{}')
    await act(async () => screen.getByTestId('accept').click())
    expect(screen.getByTestId('b').textContent).toBe('|{}')
  })
})
