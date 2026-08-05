import { defineVitestConfig } from '../../vitest.shared';

export default defineVitestConfig({
  name: 'testing',
  rootDir: 'libs/testing',
  coverageThresholds: { lines: 0, functions: 0, branches: 0, statements: 0 },
});
