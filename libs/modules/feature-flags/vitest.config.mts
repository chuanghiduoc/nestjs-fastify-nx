import { defineVitestConfig } from '../../../vitest.shared';

export default defineVitestConfig({
  name: 'modules-feature-flags',
  rootDir: 'libs/modules/feature-flags',
  integrationTests: true,
  testTimeout: 60_000,
  hookTimeout: 60_000,
});
