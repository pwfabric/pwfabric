import { defineConfig, mergeConfig } from 'vitest/config'
import rootConfig from '../../vitest.config'

export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      // Pure-helper unit tests only (router math, href rewriting, assembly,
      // PKCE helpers) — browser integration is proven elsewhere (the pwapp
      // export self-test drives a real browser), so `node` env suffices and
      // Node 22's global WebCrypto covers the PKCE hashing.
      environment: 'node',
      coverage: {
        // @pwfabric/runner — a MISSING floor is not a PASSING floor.
        //
        // lines/statements sit BELOW the project's ≥80% floor; the gap is
        // concentrated in entity-facade.ts and router.ts. The floors sit a
        // few points under the measured value — enough to catch a real
        // regression without pretending the package clears a floor it does
        // not. Raising them follows coverage work on those two modules.
        thresholds: {
          lines: 65,
          branches: 85,
          functions: 70,
          statements: 65,
        },
        exclude: [
          'vite.config.ts',
          'vitest.config.ts',
          'dist/**',
          // Browser-orchestration modules: DOM mounting, window routing,
          // full-page PKCE redirects, live Graph fetches. Exercised by the
          // browser-level pwapp export self-test, not unit-testable in node
          // without faking the exact seams the integration test covers.
          'src/run-app.ts',
          'src/auth.ts',
          'src/login-button.ts',
          // Same class as login-button: builds a DOM subtree and mounts it,
          // with no branch a node test could falsify. Its proof is
          // the browser measurement the arc ends on — an unknown address on
          // the deployed app must render this page, not the entry surface.
          'src/not-found.ts',
          'src/graph-list-connector.ts',
          'src/index.ts',
        ],
      },
    },
  })
)
