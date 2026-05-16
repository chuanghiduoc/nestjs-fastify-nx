import type { Params } from 'nestjs-pino';
import type { Options as PinoHttpOptions } from 'pino-http';
import { SENSITIVE_REDACT_CENSOR, SENSITIVE_REDACT_PATHS } from '@nestjs-fastify-nx/shared';

/**
 * Shared pino-http configuration for all NestJS apps (api, worker, scheduler).
 * Pretty-prints in non-production; ships structured JSON in production.
 * Sensitive fields are redacted at the serialiser level rather than filtered
 * upstream so the censor value appears in logs for auditability.
 *
 * Pass `overrides` to inject app-specific options (e.g. `customProps` in the
 * api app for correlation-id propagation). Override keys are shallow-merged.
 */
export function buildPinoLoggerConfig(overrides: Partial<PinoHttpOptions> = {}): Params {
  return {
    pinoHttp: {
      transport:
        process.env['NODE_ENV'] !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
          : undefined,
      level: process.env['LOG_LEVEL'] ?? 'info',
      redact: { paths: SENSITIVE_REDACT_PATHS, censor: SENSITIVE_REDACT_CENSOR },
      ...overrides,
    },
  };
}
