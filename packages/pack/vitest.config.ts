import { defineConfig, mergeConfig } from 'vitest/config'
import rootConfig from '../../vitest.config'

export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      coverage: {
        exclude: ['vitest.config.ts', 'src/__tests__/**', 'src/__fixtures__/**'],
        thresholds: {
          lines: 90,
          branches: 85,
          functions: 90,
          statements: 90,
        },
      },
    },
  })
)
