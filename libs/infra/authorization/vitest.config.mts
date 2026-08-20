import { defineVitestConfig } from '../../../vitest.shared';

export default defineVitestConfig({
  name: 'infra-authorization',
  rootDir: 'libs/infra/authorization',
  integrationTests: true,
  testTimeout: 60_000,
  hookTimeout: 60_000,
});
