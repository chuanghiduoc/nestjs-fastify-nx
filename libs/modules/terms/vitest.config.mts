import { defineVitestConfig } from '../../../vitest.shared';

export default defineVitestConfig({
  name: 'modules-terms',
  rootDir: 'libs/modules/terms',
  integrationTests: true,
  testTimeout: 60_000,
  hookTimeout: 60_000,
});
