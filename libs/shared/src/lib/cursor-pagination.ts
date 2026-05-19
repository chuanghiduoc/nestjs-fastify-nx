/**
 * Cursor helpers for stable keyset pagination.
 *
 * Cursor format: base64url("${createdAt.toISOString()}:${id}")
 * The colon is the delimiter between the sort field and the tie-breaker.
 * UUIDv7 ids are time-sortable, so (createdAt, id) is a monotonic composite
 * key — no two rows share the same cursor even when createdAt collides.
 */

export function encodeCursor(sortField: Date, id: string): string {
  return Buffer.from(`${sortField.toISOString()}:${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    // ISO 8601 UTC dates end with 'Z'. The separator colon immediately follows it.
    // Using 'Z:' as the split boundary avoids ambiguity with colons inside the
    // time portion (e.g. "T09:54:28" contains two colons before the 'Z').
    const splitIdx = raw.indexOf('Z:');
    if (splitIdx === -1) return null;
    const createdAt = new Date(raw.slice(0, splitIdx + 1)); // include the 'Z'
    const id = raw.slice(splitIdx + 2); // skip 'Z:'
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
