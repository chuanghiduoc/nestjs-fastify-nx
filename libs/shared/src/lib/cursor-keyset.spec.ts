import { describe, expect, it } from 'vitest';
import {
  decodeCursor,
  keysetAfter,
  lastCursorOf,
  paginateNewestFirst,
  takePage,
} from './cursor-pagination';

const ID_A = '01900000-0000-7000-8000-000000000001';
const ID_B = '01900000-0000-7000-8000-000000000002';
const ID_C = '01900000-0000-7000-8000-000000000003';
const SAME_TIME = new Date('2026-01-01T00:00:00.000Z');
const LATER = new Date('2026-01-02T00:00:00.000Z');

const rows = [
  { id: ID_A, createdAt: SAME_TIME },
  { id: ID_C, createdAt: LATER },
  { id: ID_B, createdAt: SAME_TIME },
];

describe('takePage', () => {
  it('reports more rows when one extra row was fetched', () => {
    expect(takePage([1, 2, 3], 2)).toEqual({ items: [1, 2], hasMore: true });
  });

  it('reports no more rows when the fetch came back short', () => {
    expect(takePage([1, 2], 2)).toEqual({ items: [1, 2], hasMore: false });
  });
});

describe('lastCursorOf', () => {
  it('returns null for an empty page', () => {
    expect(lastCursorOf([])).toBeNull();
  });

  it('encodes the last item so it decodes back to the same key', () => {
    const cursor = lastCursorOf(rows);
    expect(cursor && decodeCursor(cursor)).toEqual({ id: ID_B, createdAt: SAME_TIME });
  });
});

describe('keysetAfter', () => {
  it('breaks timestamp ties on id', () => {
    expect(keysetAfter({ createdAt: SAME_TIME, id: ID_B })).toEqual({
      OR: [{ createdAt: { lt: SAME_TIME } }, { createdAt: SAME_TIME, id: { lt: ID_B } }],
    });
  });
});

describe('paginateNewestFirst', () => {
  it('orders newest first with an id tiebreak', () => {
    const page = paginateNewestFirst(rows, { limit: 10 });
    expect(page.items.map((row) => row.id)).toEqual([ID_C, ID_B, ID_A]);
    expect(page.hasMore).toBe(false);
  });

  it('resumes strictly after the cursor, including rows sharing its timestamp', () => {
    const page = paginateNewestFirst(rows, {
      startingAfter: { createdAt: SAME_TIME, id: ID_B },
      limit: 10,
    });
    expect(page.items.map((row) => row.id)).toEqual([ID_A]);
  });

  it('flags a further page when the limit truncates', () => {
    const page = paginateNewestFirst(rows, { limit: 1 });
    expect(page).toEqual({ items: [rows[1]], hasMore: true });
  });
});
