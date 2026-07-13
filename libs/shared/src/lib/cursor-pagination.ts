// Cursor format: base64url("${createdAt.toISOString()}:${id}"). UUIDv7 id prevents duplicates on same timestamp.
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function encodeCursor(sortField: Date, id: string): string {
  return Buffer.from(`${sortField.toISOString()}:${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
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
      !UUID.test(id)
    ) {
      return null;
    }
    return { createdAt, id };
  } catch {
    return null;
  }
}
