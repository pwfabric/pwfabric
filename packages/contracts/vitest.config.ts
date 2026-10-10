import { defineConfig, mergeConfig } from 'vitest/config'
import rootConfig from '../../vitest.config'

export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      // A few tests import the whole package barrel; under a full parallel
      // workspace run that load alone can pass the 5 s default.
      testTimeout: 30_000,
      coverage: {
        exclude: ['vitest.config.ts', 'src/__tests__/**'],
        thresholds: {
          // 80% floor on every metric.
          lines: 80,
          branches: 80,
          functions: 80,
          statements: 80,
        },
      },
    },
  })
)
