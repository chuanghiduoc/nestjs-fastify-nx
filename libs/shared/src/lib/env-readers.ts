/**
 * Tiny env helpers for code paths that run BEFORE NestJS ConfigService is
 * available (Sentry init, Fastify adapter construction, Prisma constructor,
 * cron task literals). All readers must:
 *  - tolerate undefined / empty string
 *  - never throw
 *  - return the provided default on any parse failure
 *
 * Centralised so we don't end up with five subtly-different `parseIntEnv`
 * helpers drifting across the codebase.
 */

export function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Like `intEnv` but requires the parsed value to be > 0. Useful for byte
 * limits, timeouts, and any counter where 0 / negative would mean "off"
 * accidentally — callers that genuinely want to disable a feature should
 * use a separate boolean env flag.
 */
export function positiveIntEnv(name: string, fallback: number): number {
  const parsed = intEnv(name, fallback);
  return parsed > 0 ? parsed : fallback;
}

export function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw.toLowerCase() === 'true';
}
