/**
 * The static first paint: a page rendered to HTML outside a browser.
 *
 * `pwf build` writes each page's first frame into the shell (pwapp-format
 * §2.5), so a visitor sees the page before any script has run, and the
 * renderer then HYDRATES that HTML instead of drawing it again. Hydration
 * only works when the HTML is exactly what the renderer's first render in
 * the browser produces, so this module is built from the very sources of
 * `embed.js` — the same React, the same runtime, the same
 * `createSurfaceElement` — into `dist/static.js`, a script the build
 * evaluates in an isolated context (one context per build: the block loader
 * is a singleton, and one app's blocks must not reach another's render).
 *
 * The first frame is what the browser draws before anything arrives: the
 * receipt's own content and static sources, every fetched source loading
 * (one settled without a request — idle, or needing a session — settled), no
 * visitor signed in, nothing read from the address. Nothing is fetched here.
 *
 * A block whose render needs a browser (it reads `window` or `document`
 * while rendering) throws; its boundary (runtime BlockErrorBoundary) leaves
 * it to the browser, and {@link renderStatic} names it in `failed` so the
 * build can say which block broke the rule "render is pure; browser APIs
 * only in effects".
 *
 * @module @pwfabric/embed/static-render
 */

// The page's globals first: the same seeding `embed.js` does, so a block's
// imports resolve to this bundle's React and runtime.
import './embed-global.js'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { BlockModuleLoader } from '@pwfabric/runtime'
import type { BlockDefinition } from '@pwfabric/core'
import type { RenderableSurface } from '@pwfabric/runtime'
import { createSurfaceElement } from './render-core.js'
import { fatCoreOptions } from './fat.js'
import { fatOptionsOf, type EmbedOptions } from './index.js'

/** A block module the host evaluated: its component and definition, by block type. */
export interface StaticBlock {
  readonly blockType: string
  /** The module's exports (`Component` + `definition`, the bundle wrapper's names). */
  readonly module: Readonly<Record<string, unknown>>
}

/** A block that could not be rendered outside a browser. */
export interface StaticRenderFailure {
  readonly blockType: string
  readonly message: string
}

export interface StaticRenderResult {
  /** The page's HTML, to be placed in the render root (`#pw-root`). */
  readonly html: string
  /** Every block type whose render threw, once each; the browser draws those. */
  readonly failed: readonly StaticRenderFailure[]
}

let failures = new Map<string, string>()

/**
 * The component, called through a function that records a throw against its
 * block type. Calling the component from inside another function component
 * keeps its hooks where they were; the markup is the component's own.
 */
function recording(blockType: string, component: unknown): unknown {
  if (typeof component !== 'function') return component
  const Component = component as (props: unknown) => React.ReactNode
  // A class component cannot be called; it is rendered as it is.
  if ((Component as { prototype?: { isReactComponent?: unknown } }).prototype?.isReactComponent) return component
  const wrapped = (props: unknown): React.ReactNode => {
    try {
      return Component(props)
    } catch (err) {
      if (!failures.has(blockType)) failures.set(blockType, err instanceof Error ? err.message : String(err))
      throw err
    }
  }
  // What the renderer reads off the component (its declared sizing).
  Object.assign(wrapped, Component)
  return wrapped
}

/** Puts each block module in the block loader, as a browser that loaded it would. */
export function registerBlocks(blocks: readonly StaticBlock[]): void {
  for (const { blockType, module } of blocks) {
    const component = module['Component'] ?? module['default'] ?? module['component'] ?? module['render']
    if (typeof component !== 'function') continue
    const definition = module['definition']
    BlockModuleLoader.register(blockType, {
      Component: recording(blockType, component) as Parameters<typeof BlockModuleLoader.register>[1]['Component'],
      definition: definition && typeof definition === 'object' ? (definition as BlockDefinition) : null,
    })
  }
}

/**
 * The page's first frame as HTML. `surface` and `options` are what the
 * browser's first render is handed (`PWFabric.render(target, { surface },
 * options)` — the runner builds both from the same functions, first-frame.ts),
 * and they go through the same translation; the blocks must have been
 * registered.
 */
export function renderStatic(surface: RenderableSurface, options: EmbedOptions): StaticRenderResult {
  failures = new Map()
  // React reports a boundary it left to the client on the console; the
  // failure is reported once, by block type, in `failed`.
  const error = console.error
  console.error = (): void => {}
  let html: string
  try {
    html = renderToString(createSurfaceElement(fatCoreOptions(fatOptionsOf(surface, options))))
  } finally {
    console.error = error
  }
  return { html, failed: [...failures].map(([blockType, message]) => ({ blockType, message })) }
}
