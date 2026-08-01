import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from './error-codes';
import { errorTypeUrl } from './error-codes';
import { ERROR_CATALOG, ERROR_CATALOG_ENTRIES, findErrorTypeDoc } from './error-catalog';

describe('error catalog', () => {
  it('documents every error code', () => {
    const documented = new Set(ERROR_CATALOG_ENTRIES.map((doc) => doc.code));
    const undocumented = Object.values(ERROR_CODES).filter((code) => !documented.has(code));

    expect(undocumented).toEqual([]);
  });

  it('documents nothing that is not an error code', () => {
    const known = new Set<string>(Object.values(ERROR_CODES));
    const unknown = ERROR_CATALOG_ENTRIES.filter((doc) => !known.has(doc.code));

    expect(unknown).toEqual([]);
  });

  // The slug is what the served route is keyed by, so a collision would silently hide a page.
  it('derives a unique slug per code', () => {
    expect(ERROR_CATALOG.size).toBe(ERROR_CATALOG_ENTRIES.length);
  });

  it('is reachable through the slug the type URI ends with', () => {
    for (const doc of ERROR_CATALOG_ENTRIES) {
      const slug = errorTypeUrl(doc.code).split('/').pop() as string;

      expect(findErrorTypeDoc(slug)).toBe(doc);
    }
  });

  it('carries a plausible status for every entry', () => {
    for (const doc of ERROR_CATALOG_ENTRIES) {
      expect(doc.status).toBeGreaterThanOrEqual(400);
      expect(doc.status).toBeLessThan(600);
      expect(doc.title.length).toBeGreaterThan(0);
      expect(doc.meaning.length).toBeGreaterThan(0);
      expect(doc.resolution.length).toBeGreaterThan(0);
    }
  });

  it('returns nothing for an unknown slug', () => {
    expect(findErrorTypeDoc('nope')).toBeUndefined();
    expect(findErrorTypeDoc('__proto__')).toBeUndefined();
  });
});
