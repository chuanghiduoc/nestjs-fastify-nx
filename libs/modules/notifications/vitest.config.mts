import { defineVitestConfig } from '../../../vitest.shared';

export default defineVitestConfig({
  name: 'modules-notifications',
  rootDir: 'libs/modules/notifications',
  integrationTests: true,
  testTimeout: 60_000,
  hookTimeout: 60_000,
});
