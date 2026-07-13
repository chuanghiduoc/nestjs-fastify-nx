import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/api',
  plugins: [tsconfigPaths()],
  test: {
    name: 'api',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    setupFiles: ['../../vitest.setup.ts'],
    passWithNoTests: true,
    coverage: {
      reportsDirectory: '../../coverage/apps/api',
      provider: 'v8' as const,
    },
  },
}));
