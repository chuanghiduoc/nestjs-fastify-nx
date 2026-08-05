import { defineVitestConfig } from '../../../vitest.shared';

export default defineVitestConfig({
  name: 'modules-audit-log',
  rootDir: 'libs/modules/audit-log',
  integrationTests: true,
  testTimeout: 60_000,
  hookTimeout: 60_000,
});
