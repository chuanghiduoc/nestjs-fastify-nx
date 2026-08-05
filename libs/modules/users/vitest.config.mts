import { defineVitestConfig } from '../../../vitest.shared';

export default defineVitestConfig({
  name: 'modules-users',
  rootDir: 'libs/modules/users',
  integrationTests: true,
  testTimeout: 60_000,
  hookTimeout: 60_000,
});
