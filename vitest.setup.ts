import { Logger } from '@nestjs/common';

// Tests intentionally exercise error paths that trigger `logger.error(...)`.
// Real logger output spams CI logs and obscures genuine failures. Vitest
// assertions still verify behavior; logs add no signal.
//
// Set `VITEST_VERBOSE=1` to keep logs (useful when debugging a flaky test).
if (!process.env.VITEST_VERBOSE) {
  Logger.overrideLogger(false);
}

// Minimum env required by `validateConfig` so specs importing AppModule /
// CodegenAppModule don't crash during `ConfigModule.forRoot()` evaluation.
// Real values are injected by e2e / integration setups; unit tests just need
// the schema to pass.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
