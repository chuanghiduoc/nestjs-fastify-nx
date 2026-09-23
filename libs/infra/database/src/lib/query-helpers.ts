import type { Prisma } from '../generated/prisma/client';

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function jsonObjectOrEmpty(raw: Prisma.JsonValue): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
}
