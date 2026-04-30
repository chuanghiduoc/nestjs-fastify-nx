import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../../node_modules/.vite/libs/modules/users',
  plugins: [nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  test: {
    name: 'modules-users',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec,integration}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    reporters: ['default'],
    passWithNoTests: true,
    coverage: {
      reportsDirectory: '../../../coverage/libs/modules/users',
      provider: 'v8' as const,
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.integration.ts',
        'src/**/index.ts',
        'src/**/*.module.ts',
        'src/**/*.dto.ts',
        'src/**/*.decorator.ts',
        'src/**/types/**',
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
