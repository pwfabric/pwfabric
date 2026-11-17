import { defineConfig, transformWithEsbuild, type Plugin } from 'vite'

/**
 * Vite leaves whitespace in a library's ES output (it keeps the pure-call annotations
 * for a consumer's bundler). runner.js is served to visitors as it is,
 * so it is minified in full once the chunk is final; the source map follows.
 */
const minifyChunk: Plugin = {
  name: 'pwfabric-minify-runner',
  async renderChunk(code, chunk) {
    const out = await transformWithEsbuild(code, chunk.fileName, { minify: true, format: 'esm', sourcemap: true })
    return { code: out.code, map: out.map }
  },
}


/**
 * Vite lib-mode build → a single browser ES module at `dist/runner.js`.
 *
 * Externals are the shared-singleton specifiers the pwapp HTML shell resolves
 * via an importmap pointing at `./shims/*.mjs` (same contract as the
 * standalone web-app export, see embed-global.ts `__pwfabric_*` seeding):
 * react / react/jsx-runtime / zod / @pwfabric/runtime / @pwfabric/contracts are
 * NEVER bundled into runner.js — the page must dedupe them with embed.js.
 *
 * Minified: an ES module keeps its export NAMES under minification (`runApp`
 * is the boot contract, `import { runApp } from './assets/runner.js'`); only
 * internal identifiers are renamed.
 *
 * Nothing the renderer seeds is imported statically (see src/renderer.ts):
 * the runner loads first and adds the renderer when it draws a page. The
 * runtime's pure link rules come in through a subpath that is NOT in the
 * external list below, so they are bundled.
 */
export default defineConfig({
  plugins: [minifyChunk],
  build: {
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: true,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'runner.js',
    },
    rollupOptions: {
      external: [
        'react',
        'react/jsx-runtime',
        'react-dom',
        'react-dom/client',
        'zod',
        '@pwfabric/runtime',
        '@pwfabric/runtime/auth',
        '@pwfabric/contracts',
      ],
    },
  },
})
