import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import {
  safeErrorSummary,
  sanitizeSensitiveText,
  sanitizeUrlForLogging,
} from '@nestjs-fastify-nx/shared';

export interface StartSentryOptions {
  readonly serviceName: string;
  readonly profiling?: boolean;
}

// Defense-in-depth key-name redaction on every Sentry event (sendDefaultPii is
// already false). Covers auth secrets and direct PII so a stray breadcrumb or
// `extra` field never ships credentials or personal data off-box.
const SENSITIVE_KEY =
  /authorization|password|token|secret|cookie|api[-_]?key|email|phone|ssn|credit[-_]?card|card[-_]?number|tax[-_]?id/i;
const MAX_SCRUB_DEPTH = 8;

function scrub(value: unknown, depth = 0, seen = new WeakSet<object>()): void {
  if (!value || typeof value !== 'object' || depth >= MAX_SCRUB_DEPTH || seen.has(value)) return;
  seen.add(value);

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) {
      (value as Record<string, unknown>)[key] = '[Filtered]';
    } else if (typeof child === 'string') {
      (value as Record<string, unknown>)[key] = /(^|\.)(url|uri|request_url)$/i.test(key)
        ? sanitizeUrlForLogging(child)
        : sanitizeSensitiveText(child);
    } else {
      scrub(child, depth + 1, seen);
    }
  }
}

const PRODUCTION_SAMPLE_RATE_CAP = 0.1;
const DEV_SAMPLE_RATE_CAP = 1;
const DEFAULT_TRACES_SAMPLE_RATE = 0.01;

export function startSentry(options: StartSentryOptions): boolean {
  const dsn = process.env['SENTRY_DSN'];
  if (!dsn) return false;

  const isProduction = process.env['NODE_ENV'] === 'production';
  const cap = isProduction ? PRODUCTION_SAMPLE_RATE_CAP : DEV_SAMPLE_RATE_CAP;
  const parsed = Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? DEFAULT_TRACES_SAMPLE_RATE);
  const tracesSampleRate = Math.max(
    0,
    Math.min(Number.isFinite(parsed) ? parsed : DEFAULT_TRACES_SAMPLE_RATE, cap),
  );

  Sentry.init({
    dsn,
    environment: process.env['SENTRY_ENVIRONMENT'] ?? process.env['NODE_ENV'] ?? 'development',
    release: process.env['OTEL_SERVICE_VERSION'],
    initialScope: { tags: { service: options.serviceName } },
    tracesSampleRate,
    profilesSampleRate: options.profiling ? Math.min(PRODUCTION_SAMPLE_RATE_CAP, cap) : 0,
    integrations: options.profiling ? [nodeProfilingIntegration()] : undefined,
    sendDefaultPii: false,
    beforeSend(event) {
      scrub(event);
      return event;
    },
  });
  return true;
}

export async function reportFatalError(error: unknown, serviceName: string): Promise<void> {
  const rendered = safeErrorSummary(error);
  process.stderr.write(`[${serviceName}] fatal bootstrap error: ${rendered}\n`);
  Sentry.captureException(error, { tags: { service: serviceName, phase: 'bootstrap' } });
  await Sentry.flush(2_000).catch(() => false);
  // Hard exit, not just exitCode: open Prisma/ioredis sockets from a partial boot keep the event
  // loop alive, so the process would hang instead of exiting for the orchestrator to restart.
  process.exit(1);
}
