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

export function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw.toLowerCase() === 'true';
}
