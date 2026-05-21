// Cursor format: base64url("${createdAt.toISOString()}:${id}"). UUIDv7 id prevents duplicates on same timestamp.
export function encodeCursor(sortField: Date, id: string): string {
  return Buffer.from(`${sortField.toISOString()}:${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    // Split on 'Z:' to avoid ambiguity with colons inside the ISO portion (e.g. T09:54:28).
    const splitIdx = raw.indexOf('Z:');
    if (splitIdx === -1) return null;
    const createdAt = new Date(raw.slice(0, splitIdx + 1));
    const id = raw.slice(splitIdx + 2);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
