import { defineVitestConfig } from '../../../vitest.shared';

export default defineVitestConfig({
  name: 'modules-api-keys',
  rootDir: 'libs/modules/api-keys',
  integrationTests: true,
  testTimeout: 60_000,
  hookTimeout: 60_000,
});
