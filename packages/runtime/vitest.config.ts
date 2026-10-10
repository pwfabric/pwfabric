import { defineConfig, mergeConfig } from 'vitest/config'
import rootConfig from '../../vitest.config'

export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      coverage: {
        exclude: [
          // Infrastructure connectors requiring real network/DB — not unit-testable in isolation
          '**/entity/http-connector.ts',
          '**/entity/postgres-connector.ts',
          '**/entity/connector.ts',
          // Next.js-specific adapters (require Next.js environment)
          '**/adapters/next-image.tsx',
          '**/adapters/default-image.tsx',
          '**/adapters/types.ts',
          // Type-only declaration files — no executable code, only interfaces/type aliases
          '**/types.ts',
          '**/render/data-binding-types.ts',
          // React context stubs — single createContext() call, no testable logic
          '**/render/surface-event-context.ts',
          '**/render/surface-id-context.ts',
          // React lazy-loading wrapper — infrastructure, tested via integration
          '**/render/DynamicBlockWrapper.tsx',
          // Integration-level proof/spike file
          '**/proof.ts',
          // Web Vitals measurement — uses PerformanceObserver and browser-only perf APIs
          // not available in Node/vitest test environment
          '**/perf/web-vitals.ts',
          // Dev-mode-only dynamic import branch (NODE_ENV=development gate) cannot be
          // triggered in the test environment (NODE_ENV=test)
          '**/render/surface-event-bus.ts',
        ],
        thresholds: {
          // @pwfabric/runtime — the ≥80% coverage floor.
          lines: 80,
          branches: 80,
          functions: 80,
          statements: 80,
        },
      },
    },
  })
)
