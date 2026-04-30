import { Logger } from '@nestjs/common';

// Tests intentionally exercise error paths that trigger `logger.error(...)`.
// Real logger output spams CI logs and obscures genuine failures. Vitest
// assertions still verify behavior; logs add no signal.
//
// Set `VITEST_VERBOSE=1` to keep logs (useful when debugging a flaky test).
if (!process.env.VITEST_VERBOSE) {
  Logger.overrideLogger(false);
}
