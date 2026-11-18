/**
 * A page rendered outside a browser (the build's static first paint,
 * pwapp-format §2.5): a block module registered with the loader is drawn at
 * once, a block whose render throws leaves only its own boundary empty, and
 * every block reads the app's locale off its context.
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import type { DynamicBlockDescriptor } from '@pwfabric/contracts'
import { SurfaceRenderer } from '../renderer.js'
import { DynamicArtifactProvider } from '../dynamic-artifact-context.js'
import { BlockModuleLoader } from '../dynamic-block-loader.js'
import type { BlockComponent, BlockComponentProps } from '../types.js'

const Price: BlockComponent = ({ context }: BlockComponentProps) =>
  React.createElement('span', { 'data-testid': 'price' }, new Intl.NumberFormat(context.locale, { style: 'currency', currency: 'EUR' }).format(249))
const Broken: BlockComponent = () => {
  throw new Error('window is not defined')
}

const descriptor = (blockType: string): DynamicBlockDescriptor =>
  ({ blockType, moduleUrl: `blocks/${blockType}.js`, integrity: '0'.repeat(64), definition: { props: [] } }) as unknown as DynamicBlockDescriptor

afterEach(() => BlockModuleLoader.invalidate())

function page(locale: string): string {
  BlockModuleLoader.register('price', { Component: Price, definition: null })
  BlockModuleLoader.register('broken', { Component: Broken, definition: null })
  const surface = {
    blocks: [
      { id: 'p', type: 'price', props: {} },
      { id: 'x', type: 'broken', props: {} },
      { id: 'q', type: 'price', props: {} },
    ],
  }
  return renderToString(
    React.createElement(
      DynamicArtifactProvider,
      { dynamicBlocks: [descriptor('price'), descriptor('broken')] },
      React.createElement(SurfaceRenderer, { surface: surface as never, viewport: 'xs', locale })
    )
  )
}

describe('rendering a page to a string', () => {
  it('draws registered block modules and formats in the context locale', () => {
    const original = console.error
    console.error = () => undefined
    try {
      const de = page('de-DE')
      expect(de.match(/data-testid="price"/g)).toHaveLength(2)
      expect(de).toContain('249,00')
      expect(page('en-GB')).toContain('€249.00')
    } finally {
      console.error = original
    }
  })

  it('a block whose render throws is left to the browser; its neighbours are written', () => {
    const original = console.error
    console.error = () => undefined
    try {
      const html = page('en')
      // React's marker of a boundary the client renders.
      expect(html).toContain('<!--$!-->')
      expect(html.match(/data-testid="price"/g)).toHaveLength(2)
    } finally {
      console.error = original
    }
  })
})

describe('context.appHref (E3, E14)', () => {
  const Link: BlockComponent = ({ context }: BlockComponentProps) =>
    React.createElement(
      'p',
      null,
      ['/webhooks?x=1', '/', 'https://example.com/a', '#top', ''].map((to, i) =>
        React.createElement('a', { key: i, 'data-i': i, href: context.appHref(to) }, 'x')
      )
    )
  const draw = (linkHref?: (href: string) => string): string => {
    BlockModuleLoader.register('link', { Component: Link, definition: null })
    return renderToString(
      React.createElement(
        DynamicArtifactProvider,
        { dynamicBlocks: [descriptor('link')] },
        React.createElement(SurfaceRenderer, {
          surface: { blocks: [{ id: 'l', type: 'link', props: {} }] } as never,
          viewport: 'xs',
          ...(linkHref ? { linkHref } : {}),
        })
      )
    )
  }

  it('writes a page path in the host router form, the same in the first paint as in the browser', () => {
    // The runner's rule: a page path becomes its route, anything else is kept.
    const hash = (href: string): string =>
      href === '' || /^[a-z]+:|^#/i.test(href) ? href : `#/${href.replace(/^\//, '') || 'home'}`
    const html = draw(hash)
    expect(html).toContain('href="#/webhooks?x=1"')
    expect(html).toContain('href="#/home"')
    expect(html).toContain('href="https://example.com/a"')
    expect(html).toContain('href="#top"')
  })

  it('without a router, a path is written as given', () => {
    expect(draw()).toContain('href="/webhooks?x=1"')
  })
})
