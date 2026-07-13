import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../../node_modules/.vite/libs/infra/observability',
  plugins: [tsconfigPaths()],
  test: {
    name: 'infra-observability',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    setupFiles: ['../../../vitest.setup.ts'],
    passWithNoTests: true,
    coverage: {
      reportsDirectory: '../../../coverage/libs/infra/observability',
      provider: 'v8' as const,
      thresholds: {
        lines: 60,
        statements: 60,
        functions: 60,
        branches: 60,
      },
    },
  },
}));
