import { defineConfig } from 'vite'

/**
 * Vite lib-mode build → a single browser ES module at `dist/runner.js`.
 *
 * Externals are the shared-singleton specifiers the pwapp HTML shell resolves
 * via an importmap pointing at `./shims/*.mjs` (same contract as the
 * standalone web-app export, see embed-global.ts `__pwfabric_*` seeding):
 * react / react/jsx-runtime / zod / @pwfabric/runtime / @pwfabric/contracts are
 * NEVER bundled into runner.js — the page must dedupe them with embed.js.
 *
 * `minify: false` — export names are part of the runner boot contract
 * (`import { runApp } from './assets/runner.js'`) and must not be mangled.
 */
export default defineConfig({
  build: {
    target: 'es2022',
    minify: false,
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
