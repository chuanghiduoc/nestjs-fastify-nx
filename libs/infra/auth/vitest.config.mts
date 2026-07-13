import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../../node_modules/.vite/libs/infra/auth',
  plugins: [tsconfigPaths()],
  test: {
    name: 'infra-auth',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    setupFiles: ['../../../vitest.setup.ts'],
    coverage: {
      reportsDirectory: '../../../coverage/libs/infra/auth',
      provider: 'v8' as const,
    },
  },
}));
