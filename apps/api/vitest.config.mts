import { defineConfig } from 'vitest/config';

const isIntegrationRun = process.argv.includes('integration');

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/api',
  resolve: { tsconfigPaths: true },
  test: {
    maxWorkers: 2,
    name: 'api',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: isIntegrationRun ? [] : ['**/*.integration.spec.*'],
    reporters: ['default'],
    setupFiles: ['../../vitest.setup.ts'],
    passWithNoTests: true,
    coverage: {
      reportsDirectory: '../../coverage/apps/api',
      provider: 'v8' as const,
    },
  },
}));
