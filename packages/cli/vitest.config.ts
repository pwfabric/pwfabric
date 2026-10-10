import { defineConfig, mergeConfig } from 'vitest/config'
import rootConfig from '../../vitest.config'

export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      // The browser end-to-end tests live beside the sources' tests, under test/.
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts'],
      coverage: {
        exclude: ['vitest.config.ts', 'src/__tests__/**', 'src/__fixtures__/**', 'test/**'],
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
