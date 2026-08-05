import { defineVitestConfig } from '../../../vitest.shared';

export default defineVitestConfig({
  name: 'modules-upload',
  rootDir: 'libs/modules/upload',
  integrationTests: true,
  testTimeout: 60_000,
  hookTimeout: 60_000,
});
