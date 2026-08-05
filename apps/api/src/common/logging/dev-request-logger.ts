/**
 * Dev-only request logging hook - Fastify level, runs before all NestJS middleware/guards.
 * Shows: method, url (sanitized), body field names, status, duration with ANSI colors.
 *
 * This is a Fastify hook (NOT a NestJS interceptor) because:
 * 1. Interceptors run AFTER guards - a 401 rejection skips the interceptor entirely
 * 2. We want to see EVERY request, including those rejected by auth/throttler
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { sanitizeUrlForLogging } from '@nestjs-fastify-nx/shared';

const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

function colorStatus(status: number): string {
  if (status >= 500) return `${colors.red}${status}${colors.reset}`;
  if (status >= 400) return `${colors.yellow}${status}${colors.reset}`;
  if (status >= 300) return `${colors.cyan}${status}${colors.reset}`;
  return `${colors.green}${status}${colors.reset}`;
}

function colorMethod(method: string): string {
  const methodColors: Record<string, string> = {
    GET: colors.green,
    POST: colors.yellow,
    PUT: colors.blue,
    PATCH: colors.magenta,
    DELETE: colors.red,
  };
  const color = methodColors[method] || colors.gray;
  return `${color}${method.padEnd(7)}${colors.reset}`;
}

/**
 * Summarize body as field names only - never log sensitive values.
 */
function summarizeBody(body: unknown): string {
  if (!body || typeof body !== 'object') return '(non-object)';
  const keys = Object.keys(body);
  if (keys.length === 0) return '(empty)';
  const preview = keys.slice(0, 10).join(', ');
  return keys.length > 10 ? `{${preview}, ...+${keys.length - 10}}` : `{${preview}}`;
}

const NOISY_PATHS = ['/api/v1/health', '/metrics', '/api/health'];

/**
 * Register dev request logger as Fastify hooks.
 * Call this in main.ts ONLY when NODE_ENV !== 'production'.
 */
export function registerDevRequestLogger(fastify: FastifyInstance): void {
  const requestTimes = new WeakMap<FastifyRequest, number>();

  // Log request start - runs before everything
  fastify.addHook('onRequest', (req: FastifyRequest) => {
    if (NOISY_PATHS.some((p) => req.url.startsWith(p))) return;
    requestTimes.set(req, performance.now());

    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    const safeUrl = sanitizeUrlForLogging(req.url) ?? req.url;
    console.log(`${colors.dim}${timestamp}${colors.reset} ${colorMethod(req.method)} ${safeUrl}`);
  });

  // Log body field names after parsing (for mutations) - never log values
  fastify.addHook('preHandler', (req: FastifyRequest) => {
    if (NOISY_PATHS.some((p) => req.url.startsWith(p))) return;
    if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return;
    if (!req.body) return;

    const summary = summarizeBody(req.body);
    console.log(`${colors.dim}            └─ body: ${summary}${colors.reset}`);
  });

  // Log response - runs after everything, including errors
  fastify.addHook('onResponse', (req: FastifyRequest, reply: FastifyReply) => {
    if (NOISY_PATHS.some((p) => req.url.startsWith(p))) return;

    const start = requestTimes.get(req);
    const duration = start ? (performance.now() - start).toFixed(0) : '?';

    console.log(
      `${colors.dim}            └─${colors.reset} ${colorStatus(reply.statusCode)} ` +
        `${colors.dim}in ${duration}ms${colors.reset}`,
    );
  });
}
