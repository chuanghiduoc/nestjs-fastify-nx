import { defineVitestConfig } from '../../../vitest.shared';

export default defineVitestConfig({
  name: 'infra-i18n',
  rootDir: 'libs/infra/i18n',
  coverageExclude: ['src/lib/i18n-infra.module.ts', 'src/lib/i18n-helpers.ts'],
  coverageThresholds: { lines: 0, functions: 0, branches: 0, statements: 0 },
});
