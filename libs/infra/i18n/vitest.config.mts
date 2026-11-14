import { defineVitestConfig } from '../../../vitest.shared';

export default defineVitestConfig({
  name: 'infra-i18n',
  rootDir: 'libs/infra/i18n',
  coverageExclude: ['src/lib/i18n-infra.module.ts'],
  coverageThresholds: { lines: 60, functions: 60, branches: 60, statements: 60 },
});
