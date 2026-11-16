import { defineVitestConfig } from '../../vitest.shared';

export default defineVitestConfig({
  name: 'infra',
  rootDir: 'libs/infra',
  integrationTests: true,
  testTimeout: 60_000,
  hookTimeout: 60_000,
  coverageExclude: [
    'src/authorization/lib/postgres-pbac.adapter.ts',
    'src/authorization/lib/authorization.module.ts',
    'src/authorization/lib/authorization-conformance.ts',
  ],
});
