import { defineVitestConfig } from '../../../vitest.shared';

export default defineVitestConfig({
  name: 'infra-authorization',
  rootDir: 'libs/infra/authorization',
  integrationTests: true,
  testTimeout: 60_000,
  hookTimeout: 60_000,
  // The Postgres adapter is covered by the shared conformance suite, which needs a real database
  // and therefore only runs in the integration lane — it reads as 0% here. The module is DI wiring
  // and the conformance file is the test harness itself.
  coverageExclude: [
    'src/lib/postgres-pbac.adapter.ts',
    'src/lib/authorization.module.ts',
    'src/lib/authorization-conformance.ts',
  ],
});
