import { defineVitestConfig } from '../../vitest.shared';

export default defineVitestConfig({
  name: 'migration',
  rootDir: 'apps/migration',
  coverageExclude: ['src/main.ts'],
});
