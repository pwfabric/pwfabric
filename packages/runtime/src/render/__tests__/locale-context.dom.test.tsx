// @vitest-environment jsdom
/**
 * An app in several languages on the page (envelope §2.3): a receipt reads a
 * word by `{{t('<id>')}}` from the catalogue the host hands the renderer, its
 * plurals in the locale drawn; every block's context carries `locale`,
 * `locales` and `alternates`.
 */
import '../../__tests__/dom-test-setup.js'
import { afterEach, describe, expect, it } from 'vitest'
import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import type { Block } from '@pwfabric/core'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import { AppLocaleContext, AppMessagesContext } from '../app-messages.js'
import type { BlockComponentRegistry, BlockContext } from '../types.js'

afterEach(cleanup)

const Text = ({ block, props }: { block: Block; props: Record<string, unknown> }) => <p data-testid={block.id}>{String(props.content ?? '')}</p>
const Switch = ({ block, context }: { block: Block; context: BlockContext }) => (
  <p data-testid={block.id}>{`${context.locale}|${(context.locales ?? []).join(',')}|${JSON.stringify(context.alternates ?? null)}`}</p>
)
const components = { text: Text, switch: Switch } as unknown as BlockComponentRegistry
const L = DEFAULT_BLOCK_LAYOUT

const surface = {
  id: 's',
  title: "{{t('page.title')}}",
  blocks: [
    { id: 'intro', type: 'text', layout: L, props: { content: "{{t('intro')}}" } },
    { id: 'count', type: 'text', layout: L, props: { content: "{{t('cart', state.counts)}}" } },
    { id: 'none', type: 'text', layout: L, props: { content: "[{{t('missing')}}]" } },
    { id: 'lang', type: 'switch', layout: L, props: {} },
  ],
  // The grammar has no object literal: a message's values come from the page scope.
  capabilities: [{ capability: 'platform/persistence', config: { initialState: { counts: { n: 3 } } } }],
}

function view(messages: Record<string, string>, locale: string, extra: Record<string, unknown> = {}, onTitle?: (t: string | undefined) => void) {
  return (
    <AppMessagesContext.Provider value={messages}>
      <AppLocaleContext.Provider value={locale}>
        <DataBoundSurfaceRenderer surface={surface as never} components={components} locale={locale} loadingStrategy="immediate" {...extra} {...(onTitle ? { onTitle } : {})} />
      </AppLocaleContext.Provider>
    </AppMessagesContext.Provider>
  )
}

describe('{{t(id, vars?)}} and the locale on the context', () => {
  it("reads the drawn locale's words, plurals in its rules, nothing for an id no catalogue sets", () => {
    const titles: (string | undefined)[] = []
    render(view({ intro: 'Frisches Brot', cart: '{n, plural, one {# Brot} other {# Brote}}', 'page.title': 'Startseite' }, 'de', {}, (t) => titles.push(t)))
    expect(screen.getByTestId('intro').textContent).toBe('Frisches Brot')
    expect(screen.getByTestId('count').textContent).toBe('3 Brote')
    expect(screen.getByTestId('none').textContent).toBe('[]')
    expect(titles).toContain('Startseite')
  })

  it('hands every block locale, locales and alternates', () => {
    render(view({}, 'de', { locales: ['en', 'de'], alternates: { en: '/pricing/', de: '/de/preise/' } }))
    expect(screen.getByTestId('lang').textContent).toBe('de|en,de|{"en":"/pricing/","de":"/de/preise/"}')
  })

  it('names the one locale of a single-language app, and no alternates', () => {
    render(view({}, 'en-GB'))
    expect(screen.getByTestId('lang').textContent).toBe('en-GB|en-GB|null')
  })
})

describe('a page with nothing dynamic but its words', () => {
  it('is resolved too', () => {
    const plain = { id: 'p', blocks: [{ id: 'intro', type: 'text', layout: L, props: { content: "{{t('intro')}}" } }] }
    render(
      <AppMessagesContext.Provider value={{ intro: 'Fresh bread' }}>
        <DataBoundSurfaceRenderer surface={plain as never} components={components} loadingStrategy="immediate" />
      </AppMessagesContext.Provider>
    )
    expect(screen.getByTestId('intro').textContent).toBe('Fresh bread')
  })
})
