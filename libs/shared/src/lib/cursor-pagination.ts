import { validate as isUuid, version as uuidVersion } from 'uuid';

// Cursor format: base64url("${createdAt.toISOString()}:${id}"). UUIDv7 id prevents duplicates on same timestamp.
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const UUID_VERSION = 7;

// A cursor that has already passed validation. Repository ports take this rather than the raw
// string so a malformed cursor is unrepresentable below the boundary that decodes it.
export interface DecodedCursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(sortField: Date, id: string): string {
  return Buffer.from(`${sortField.toISOString()}:${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): DecodedCursor | null {
  try {
    if (!cursor || !BASE64URL.test(cursor)) return null;
    const bytes = Buffer.from(cursor, 'base64url');
    // Buffer's decoder is deliberately permissive. Round-tripping rejects malformed or
    // non-canonical input rather than allowing it to reach a UUID comparison in Postgres.
    if (bytes.toString('base64url') !== cursor) return null;

    const raw = bytes.toString('utf8');
    // Split on 'Z:' to avoid ambiguity with colons inside the ISO portion (e.g. T09:54:28).
    const splitIdx = raw.indexOf('Z:');
    if (splitIdx === -1) return null;
    const encodedDate = raw.slice(0, splitIdx + 1);
    const createdAt = new Date(encodedDate);
    const id = raw.slice(splitIdx + 2);
    if (
      Number.isNaN(createdAt.getTime()) ||
      createdAt.toISOString() !== encodedDate ||
      !isUuid(id) ||
      uuidVersion(id) !== UUID_VERSION
    ) {
      return null;
    }
    return { createdAt, id };
  } catch {
    return null;
  }
}

export interface CursorKeyed {
  readonly createdAt: Date;
  readonly id: string;
}

export interface CursorPageSlice<T> {
  items: T[];
  hasMore: boolean;
}

export function keysetAfter(cursor: DecodedCursor) {
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

export function takePage<T>(rows: readonly T[], limit: number): CursorPageSlice<T> {
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

export function lastCursorOf(items: readonly CursorKeyed[]): string | null {
  const last = items.at(-1);
  return last ? encodeCursor(last.createdAt, last.id) : null;
}

export function compareNewestFirst(left: CursorKeyed, right: CursorKeyed): number {
  const byDate = right.createdAt.getTime() - left.createdAt.getTime();
  return byDate !== 0 ? byDate : right.id.localeCompare(left.id);
}

export function paginateNewestFirst<T extends CursorKeyed>(
  rows: readonly T[],
  page: { startingAfter?: DecodedCursor; limit: number },
): CursorPageSlice<T> {
  const { startingAfter, limit } = page;
  const sorted = [...rows].sort(compareNewestFirst);
  const remaining = startingAfter
    ? sorted.filter((row) => compareNewestFirst(row, startingAfter) > 0)
    : sorted;
  return takePage(remaining, limit);
}
