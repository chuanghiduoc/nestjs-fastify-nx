import { defineVitestConfig } from '../../../vitest.shared';

export default defineVitestConfig({
  name: 'modules-organizations',
  rootDir: 'libs/modules/organizations',
  integrationTests: true,
  testTimeout: 60_000,
  hookTimeout: 60_000,
});
