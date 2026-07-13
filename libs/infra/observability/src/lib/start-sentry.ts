import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

export interface StartSentryOptions {
  readonly serviceName: string;
  readonly profiling?: boolean;
}

const SENSITIVE_KEY = /authorization|password|token|secret|cookie|api[-_]?key/i;
const MAX_SCRUB_DEPTH = 8;

function scrub(value: unknown, depth = 0, seen = new WeakSet<object>()): void {
  if (!value || typeof value !== 'object' || depth >= MAX_SCRUB_DEPTH || seen.has(value)) return;
  seen.add(value);

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) {
      (value as Record<string, unknown>)[key] = '[Filtered]';
    } else {
      scrub(child, depth + 1, seen);
    }
  }
}

export function startSentry(options: StartSentryOptions): boolean {
  const dsn = process.env['SENTRY_DSN'];
  if (!dsn) return false;

  const isProduction = process.env['NODE_ENV'] === 'production';
  const cap = isProduction ? 0.1 : 1;
  const parsed = Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? 0.01);
  const tracesSampleRate = Math.max(0, Math.min(Number.isFinite(parsed) ? parsed : 0.01, cap));

  Sentry.init({
    dsn,
    environment: process.env['SENTRY_ENVIRONMENT'] ?? process.env['NODE_ENV'] ?? 'development',
    release: process.env['OTEL_SERVICE_VERSION'],
    initialScope: { tags: { service: options.serviceName } },
    tracesSampleRate,
    profilesSampleRate: options.profiling ? Math.min(0.1, cap) : 0,
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
  const rendered = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`[${serviceName}] fatal bootstrap error: ${rendered}\n`);
  Sentry.captureException(error, { tags: { service: serviceName, phase: 'bootstrap' } });
  await Sentry.flush(2_000).catch(() => false);
  process.exitCode = 1;
}
