import { defineConfig, mergeConfig } from 'vitest/config'
import rootConfig from '../../vitest.config'

export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      coverage: {
        exclude: ['vitest.config.ts', 'vitest.setup.ts', 'src/__tests__/**'],
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
