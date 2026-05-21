import type { Params } from 'nestjs-pino';
import type { Options as PinoHttpOptions } from 'pino-http';
import { SENSITIVE_REDACT_CENSOR, SENSITIVE_REDACT_PATHS } from '@nestjs-fastify-nx/shared';

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
