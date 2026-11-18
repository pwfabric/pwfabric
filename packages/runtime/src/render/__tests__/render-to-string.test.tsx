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
  ({ blockType, moduleUrl: `blocks/${blockType}.js`, integrity: '0'.repeat(64) }) as unknown as DynamicBlockDescriptor

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
