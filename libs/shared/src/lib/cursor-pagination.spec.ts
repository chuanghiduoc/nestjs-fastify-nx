import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from './cursor-pagination';

describe('cursor-pagination helpers', () => {
  const fixedDate = new Date('2026-05-18T09:54:28.000Z');
  const fixedId = '019dd1a5-9235-70db-8d57-54ef901d8185';

  describe('encodeCursor / decodeCursor round-trip', () => {
    it('encodes and decodes back to original values', () => {
      const cursor = encodeCursor(fixedDate, fixedId);
      const decoded = decodeCursor(cursor);

      if (!decoded) throw new Error('expected cursor to decode');
      expect(decoded.createdAt.toISOString()).toBe(fixedDate.toISOString());
      expect(decoded.id).toBe(fixedId);
    });

    it('produces a base64url string (no +, /, or = characters)', () => {
      const cursor = encodeCursor(fixedDate, fixedId);
      expect(cursor).not.toMatch(/[+/=]/);
    });

    it('produces different cursors for different inputs', () => {
      const c1 = encodeCursor(fixedDate, fixedId);
      const c2 = encodeCursor(
        new Date('2026-01-01T00:00:00.000Z'),
        '019b76da-a800-7000-8000-000000000001',
      );
      expect(c1).not.toBe(c2);
    });
  });

  describe('decodeCursor — invalid inputs return null', () => {
    it('returns null for an empty string', () => {
      expect(decodeCursor('')).toBeNull();
    });

    it('returns null for a string that lacks the Z: separator', () => {
      // "nodot" has no 'Z:' sequence after decoding
      const nosep = Buffer.from('nodot').toString('base64url');
      expect(decodeCursor(nosep)).toBeNull();
    });

    it('returns null when the date portion is invalid', () => {
      const bad = Buffer.from('not-a-date:' + fixedId).toString('base64url');
      expect(decodeCursor(bad)).toBeNull();
    });

    it('returns null when the id portion is empty after Z: separator', () => {
      // "2026-05-18T09:54:28.000Z:" — id is empty string after split
      const bad = Buffer.from(fixedDate.toISOString() + ':').toString('base64url');
      expect(decodeCursor(bad)).toBeNull();
    });

    it('returns null when the id is not a UUID', () => {
      const bad = Buffer.from(`${fixedDate.toISOString()}:not-a-uuid`).toString('base64url');
      expect(decodeCursor(bad)).toBeNull();
    });

    it('returns null for permissively-decodable but non-canonical base64url', () => {
      expect(decodeCursor(`${encodeCursor(fixedDate, fixedId)}=`)).toBeNull();
    });

    it('returns null for completely garbage input', () => {
      expect(decodeCursor('!!!garbage!!!')).toBeNull();
    });
  });
});
