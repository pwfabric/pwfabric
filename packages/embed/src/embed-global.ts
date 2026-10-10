/**
 * IIFE global entry.
 *
 * Built by tsup with `format: 'iife'` + `globalName: 'PWFabric'` and
 * `noExternal` everything, so React + react-dom + the runtime are all bundled in
 * and the emitted `dist/embed.js` is a zero-dependency `<script>` drop-in that
 * exposes `window.PWFabric`.
 *
 * The named exports here become properties of the global `PWFabric` object, so
 * a consumer can call `PWFabric.render(...)`, `PWFabric.renderFat(...)`, etc.
 * Importing this module also runs `index.ts`'s side-effect auto-loader.
 *
 * @module @pwfabric/embed/embed-global
 */

export {
  render,
  renderFat,
  loadThin,
  autoload,
  buildFatHtml,
  mountSurface,
  createSurfaceElement,
  createOfflineEntityFacade,
  createOfflineNavigationProvider,
  staticPersistenceCapability,
  grantsToDescriptors,
} from './index.js'

// ============================================================
// SHARED-SINGLETON VENDOR GLOBAL
// ============================================================
//
// Dynamically-loaded block bundles (the offline fat-preview `data:`/blob ESM
// modules built by a local block bundler) MUST share THIS IIFE's single
// React / react-dom / runtime / contracts / zod instances instead of inlining
// their own copies. Two independent failure classes motivate this:
//
//   1. A block that inlines its own React calls hooks against a *different*
//      dispatcher than the embed renderer's React → "Cannot read properties of
//      null (reading 'useState')".
//   2. A block that leaves a bare `@pwfabric/contracts`
//      import unresolved → "Failed to resolve module specifier" inside the
//      blob/data module (bare specifiers don't resolve there, no import map).
//
// We expose the already-bundled singletons on a well-known global. The
// block-bundler rewrites each shared specifier to a tiny virtual ESM shim that
// re-exports from `globalThis.__PW_VENDOR__['<specifier>']`, so every block
// shares exactly these instances. These are the SAME module objects the embed
// renderer uses (they're bundled into this IIFE), guaranteeing one React
// dispatcher and one set of contract values across host + blocks.
// NOTE on zod: zod is NOT exposed here. It has no React-dispatcher / context
// identity concern (it is a leaf value library), and the embed package does
// not declare it as a direct dependency, so the block-bundler keeps zod
// INLINED per-block. Only the identity-sensitive singletons live below.
import * as React from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import * as ReactDom from 'react-dom'
import * as ReactDomClient from 'react-dom/client'
import * as Runtime from '@pwfabric/runtime'
import * as Contracts from '@pwfabric/contracts'
import * as Core from '@pwfabric/core'
import * as Authoring from '@pwfabric/authoring'
import * as Zod from 'zod'

declare global {
  var __PW_VENDOR__: Record<string, unknown> | undefined
}

if (typeof globalThis !== 'undefined') {
  globalThis.__PW_VENDOR__ = {
    react: React,
    'react/jsx-runtime': ReactJsxRuntime,
    'react-dom': ReactDom,
    'react-dom/client': ReactDomClient,
    '@pwfabric/runtime': Runtime,
    '@pwfabric/contracts': Contracts,
    // `@pwfabric/core` is here so a host shell can seed `__pwfabric_core`
    // from THIS bundle's instance — the pwf CLI's standalone shell does. The
    // runtime already bundles core, so it costs little. The authoring kit (the
    // `sdk@v1` shim's package) is also seeded below as `__pwfabric_sdk`.
    '@pwfabric/core': Core,
    '@pwfabric/authoring': Authoring,
  }
}

// ============================================================
// STANDALONE WEB APP EXPORT — __pwfabric_* import-map shims
// ============================================================
//
// A DIFFERENT set of dynamically-loaded block bundles — the published
// atoms a host's bundle service compiles (esbuild, `external`:
// react/react-dom/jsx-runtime/zod/the @pwfabric packages,
// literal bare specifiers left in the output) — are loaded via a browser
// native `<script type="importmap">` + `import(blob:...)`, NOT via
// `__PW_VENDOR__` (that's the local block bundler's own,
// specifier-rewriting mechanism — a parallel, unrelated system). Inside a
// live host app, its providers module seeds these same `globalThis.__pwfabric_*`
// globals from its own bundler-resolved imports, and the import-map shims
// (`_pwfabric/shims/*.mjs`) re-export from them. A STANDALONE EXPORTED site
// has no host app to do that seeding — this IIFE (already loaded via a
// plain `<script>` tag, before any block bundle's dynamic import fires) is
// the only thing that can, so it does the exact same assignment here. The
// exported site ships the SAME shim files (copied verbatim) + the same
// import map, pointing at these globals.
if (typeof globalThis !== 'undefined') {
  const g = globalThis as Record<string, unknown>
  g.__pwfabric_react = React
  g.__pwfabric_jsx_runtime = ReactJsxRuntime
  // The authoring kit: a block written the documented way imports
  // `defineBlock` from `@pwfabric/authoring` and calls it when its bundle
  // loads, so a page that renders shipped blocks must seed it — every
  // published app and every `pwf build` export is such a page, and this
  // bundle is the only thing on it that can. It is already in this bundle
  // (the vendor table above carries it), so seeding it costs nothing.
  g.__pwfabric_sdk = Authoring
  g.__pwfabric_zod = Zod
  // Mirrors a host's providers module: @pwfabric/runtime re-exports the public
  // contracts surface, so the SAME module namespace backs both globals.
  g.__pwfabric_contracts = Runtime
  g.__pwfabric_runtime = Runtime
}
