import { defineConfig } from 'vitest/config'

/**
 * Root vitest config for the PWFabric engine workspace.
 *
 * Per-package vitest.config.ts files merge this base via `mergeConfig`,
 * overriding `environment` and `coverage.thresholds` as needed.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.e2e.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: [
        'vitest.config.ts',
        'vitest.setup.ts',
        'dist/**',
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/__tests__/**',
        'src/**/*.d.ts',
      ],
    },
  },
})
