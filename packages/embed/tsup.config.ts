import { defineConfig } from 'tsup'

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
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    esbuildOptions(options) {
      options.jsx = 'automatic'
    },
  },
])
