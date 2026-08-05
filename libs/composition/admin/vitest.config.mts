import { defineVitestConfig } from '../../../vitest.shared';

export default defineVitestConfig({
  name: 'composition-admin',
  rootDir: 'libs/composition/admin',
  integrationTests: true,
  testTimeout: 60_000,
  hookTimeout: 60_000,
});
