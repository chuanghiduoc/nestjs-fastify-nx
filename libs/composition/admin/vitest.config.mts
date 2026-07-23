import { defineConfig } from 'vitest/config';

const isIntegrationRun = process.argv.includes('integration');

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../../node_modules/.vite/libs/composition/admin',
  resolve: { tsconfigPaths: true },
  test: {
    maxWorkers: 2,
    name: 'composition-admin',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec,integration}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    exclude: isIntegrationRun ? [] : ['**/*.integration.spec.*'],
    reporters: ['default'],
    setupFiles: ['../../../vitest.setup.ts'],
    passWithNoTests: true,
    coverage: {
      reportsDirectory: '../../../coverage/libs/composition/admin',
      provider: 'v8' as const,
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.integration.ts',
        'src/**/index.ts',
        'src/**/*.module.ts',
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
      },
    },
  },
}));
