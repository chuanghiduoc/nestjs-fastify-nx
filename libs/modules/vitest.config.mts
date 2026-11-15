import { defineVitestConfig } from '../../vitest.shared';

export default defineVitestConfig({
  name: 'modules',
  rootDir: 'libs/modules',
  integrationTests: true,
  coverageExclude: ['src/**/prisma-*.repository.ts'],
});
