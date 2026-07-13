import { hostname } from 'node:os';
import { RequestMethod } from '@nestjs/common';
import { stdSerializers } from 'pino';
import type { Params } from 'nestjs-pino';
import type { Options as PinoHttpOptions } from 'pino-http';
import { ClsServiceManager } from 'nestjs-cls';
import type { RequestContextStore } from '@nestjs-fastify-nx/core';
import { SENSITIVE_REDACT_CENSOR, SENSITIVE_REDACT_PATHS } from '@nestjs-fastify-nx/shared';

// Runs on every log line regardless of call site (handlers, repositories, listeners — not
// just the per-request HTTP access log), since pino invokes `mixin` at write time for the
// whole logger tree, not only the pino-http child logger. ClsServiceManager reads the CLS
// AsyncLocalStorage directly (no DI), so this stays a no-op in apps that never seed the
// store (worker, scheduler) instead of throwing. @opentelemetry/instrumentation-pino wraps
// (not replaces) an existing `mixin`, so trace_id/span_id from OTel are additive to this.
function requestContextMixin(): Record<string, string> {
  const store = ClsServiceManager.getClsService<RequestContextStore>()?.get();
  if (!store) return {};

  const fields: Record<string, string> = {};
  if (store.requestId) fields['requestId'] = store.requestId;
  if (store.correlationId) fields['correlationId'] = store.correlationId;
  if (store.userId) fields['userId'] = store.userId;
  return fields;
}

// Kubernetes liveness/readiness + Prometheus scrapes hit on a fixed interval; logging every
// probe would bury real traffic. The OTel trace still records them for latency analysis.
function isNoisyProbe(url: string | undefined): boolean {
  if (!url) return false;
  const path = url.split('?', 1)[0];
  return path === '/metrics' || path.startsWith('/api/v1/health');
}

export function buildPinoLoggerConfig(overrides: Partial<PinoHttpOptions> = {}): Params {
  const isProduction = process.env['NODE_ENV'] === 'production';
  const prettyLogs = !isProduction && process.env['LOG_PRETTY'] !== 'false';
  const service = process.env['OTEL_SERVICE_NAME'] ?? 'app';
  const env = process.env['NODE_ENV'] ?? 'development';

  return {
    // nestjs-pino's backward-compatible default is `*`, which Nest 11 has to
    // auto-convert on Fastify 5. Use the named optional wildcard for every HTTP method.
    forRoutes: [{ path: '{*splat}', method: RequestMethod.ALL }],
    pinoHttp: {
      transport: prettyLogs
        ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
        : undefined,
      level: process.env['LOG_LEVEL'] ?? 'info',
      // Service identity on every line for filtering; trace_id/span_id come from the OTel
      // pino instrumentation (start-tracing.ts).
      base: { service, env, pid: process.pid, hostname: hostname() },
      // requestId/correlationId/userId on every line app-wide — see requestContextMixin().
      mixin: requestContextMixin,
      // Structured logs use a string level label; pino-pretty expects the numeric level.
      formatters: !prettyLogs ? { level: (label) => ({ level: label }) } : undefined,
      autoLogging: { ignore: (req) => isNoisyProbe(req.url) },
      // Request essentials only, not the full header/body dump — smaller lines, smaller PII surface.
      // `remoteAddress` is the raw TCP peer (pod IP behind a proxy); pair with X-Forwarded-For
      // upstream if you need the client IP. err keeps stack/message/cause in prod JSON.
      serializers: {
        err: stdSerializers.err,
        req: (req: { method?: string; url?: string; remoteAddress?: string }) => ({
          method: req.method,
          url: req.url,
          remoteAddress: req.remoteAddress,
        }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      },
      redact: { paths: SENSITIVE_REDACT_PATHS, censor: SENSITIVE_REDACT_CENSOR },
      ...overrides,
    },
  };
}
