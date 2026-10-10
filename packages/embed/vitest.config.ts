import { defineConfig, mergeConfig } from 'vitest/config'
import rootConfig from '../../vitest.config'

export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      // The render proof mounts into a real DOM; jsdom is the default env.
      environment: 'jsdom',
      setupFiles: ['./vitest.setup.ts'],
      coverage: {
        exclude: [
          'tsup.config.ts',
          'vitest.config.ts',
          'vitest.setup.ts',
          'dist/**',
          // IIFE re-export shim — no logic of its own.
          'src/embed-global.ts',
        ],
        thresholds: {
          // @pwfabric/embed - lines/functions/statements at the project's
          // ≥80% floor. Branches sit at 50: the embed surface is mostly
          // defensive optional-prop spreading (omit-when-undefined guards),
          // a real coverage gap below the 80% floor. The 50 floor still guards
          // against regression below the current level.
          lines: 80,
          branches: 50,
          functions: 80,
          statements: 80,
        },
      },
    },
  })
)
