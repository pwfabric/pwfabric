import { defineConfig } from 'tsup'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Plugin } from 'esbuild'
import { visitorBundlePlugins } from './visitor-bundle'

/**
 * `react-dom/server` as its string renderer alone. The package entry also
 * carries the streaming renderer, which needs a `MessageChannel` when it
 * loads (and keeps a Node process alive with it); the static first paint
 * only ever calls `renderToString`.
 */
const reactDomServerString: Plugin = {
  name: 'pwfabric-react-dom-server-string',
  setup(build) {
    const root = dirname(createRequire(import.meta.url).resolve('react-dom/package.json'))
    build.onResolve({ filter: /^react-dom\/server$/ }, () => ({
      path: join(root, 'cjs', 'react-dom-server-legacy.browser.production.js'),
    }))
  },
}

/**
 * Two build outputs:
 *
 * 1. `dist/index.js` — ESM entry for bundler consumers. React, react-dom,
 *    and the runtime are EXTERNAL (peer deps) so the host app dedupes them.
 *    Type declarations are emitted here.
 *
 * 2. `dist/embed.js` — zero-dependency IIFE that exposes a global `PWFabric`.
 *    React + react-dom + the runtime are bundled IN (`noExternal: [/.* /]`)
 *    so the file is a self-contained `<script>` drop-in with no import map
 *    and no external dependency. This is what `buildFatHtml` inlines and what
 *    the surface-export "embed" snippet ultimately points at.
 */
export default defineConfig([
  // ── the static first paint (dist/static.js) ───────────────────────
  // The renderer of embed.js plus react-dom/server, as one script the build
  // evaluates in an isolated context to write each page's first frame
  // (see src/static-render.ts). Built from the same sources, in the same
  // build, as embed.js: its HTML is what embed.js hydrates.
  {
    entry: { static: 'src/static-render.ts' },
    format: ['iife'],
    globalName: 'PWFabricStatic',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: false,
    clean: false,
    minify: true,
    splitting: false,
    treeshake: true,
    outExtension() {
      return { js: '.js' }
    },
    noExternal: [/.*/],
    esbuildPlugins: [reactDomServerString, ...visitorBundlePlugins],
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    esbuildOptions(options) {
      options.jsx = 'automatic'
    },
  },
  // ── ESM library build (externalised React + runtime) ──────────────
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    dts: { resolve: true, compilerOptions: { composite: false, incremental: false } },
    sourcemap: true,
    clean: false,
    splitting: false,
    treeshake: true,
    external: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react-dom/client',
      '@pwfabric/runtime',
      '@pwfabric/contracts',
    ],
    esbuildOptions(options) {
      options.jsx = 'automatic'
    },
  },
  // ── IIFE global build (everything bundled, zero external deps) ────
  {
    entry: { embed: 'src/embed-global.ts' },
    format: ['iife'],
    globalName: 'PWFabric',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: false,
    clean: false,
    minify: true,
    splitting: false,
    treeshake: true,
    // tsup names IIFE output `<name>.global.js`; rename to the contracted
    // `embed.js` so the `exports` map + buildFatHtml inlining line up.
    outExtension() {
      return { js: '.js' }
    },
    // Bundle EVERYTHING — React, react-dom, runtime, contracts — so the
    // emitted file has no external dependency whatsoever.
    noExternal: [/.*/],
    // What no visitor needs (zod's message locales, next/image); see
    // visitor-bundle.ts.
    esbuildPlugins: visitorBundlePlugins,
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    esbuildOptions(options) {
      options.jsx = 'automatic'
    },
  },
])
