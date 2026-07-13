import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/shared',
  plugins: [tsconfigPaths()],
  test: {
    name: 'shared',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    setupFiles: ['../../vitest.setup.ts'],
    passWithNoTests: true,
    coverage: {
      reportsDirectory: '../../coverage/libs/shared',
      provider: 'v8' as const,
    },
  },
}));
