// For code paths that run before ConfigService is available (Sentry init, Fastify adapter, cron literals).
export function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const normalized = raw.trim();
  if (!/^-?\d+$/.test(normalized)) return fallback;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

// Falls back when value ≤ 0 — use a separate bool flag to intentionally disable a feature.
export function positiveIntEnv(name: string, fallback: number): number {
  const parsed = intEnv(name, fallback);
  return parsed > 0 ? parsed : fallback;
}

// Mirrors intEnv's treatment of a set-but-empty value (`KEY=` in a .env file loads as `""`): fall
// back rather than silently reading it as `false`, which would make an explicit default of `true`
// unreachable. Only the literal `true` enables — anything else is off, so a typo fails safe.
export function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw.trim().toLowerCase() === 'true';
}

// `KEY=` in a .env file arrives as `""`, not `undefined`, so a zod `.optional()` would still run
// `.min(1)` on the empty string and fail — and `.default()` would never apply. Stripping empties
// first lets optional fields fall back to their defaults and keeps required fields failing loudly.
// Shared by every per-app env validator so the three schemas cannot drift on this preprocessing.
export function stripEmptyEnvStrings(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    out[key] = typeof value === 'string' && value.trim() === '' ? undefined : value;
  }
  return out;
}
