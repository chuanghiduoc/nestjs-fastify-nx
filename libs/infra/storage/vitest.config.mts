import { defineConfig } from 'vitest/config';

const isIntegrationRun = process.argv.includes('integration');

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../../node_modules/.vite/libs/infra/storage',
  resolve: { tsconfigPaths: true },
  test: {
    name: 'infra-storage',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: isIntegrationRun ? [] : ['**/*.integration.spec.*'],
    reporters: ['default'],
    setupFiles: ['../../../vitest.setup.ts'],
    passWithNoTests: true,
    coverage: {
      reportsDirectory: '../../../coverage/libs/infra/storage',
      provider: 'v8' as const,
    },
  },
}));
