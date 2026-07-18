import { describe, it, expect } from 'vitest';
import { buildPageMeta, paginationSkip } from './pagination.types';

describe('paginationSkip', () => {
  it('computes (page - 1) * pageSize for valid input', () => {
    expect(paginationSkip({ page: 1, pageSize: 20 })).toBe(0);
    expect(paginationSkip({ page: 2, pageSize: 20 })).toBe(20);
    expect(paginationSkip({ page: 5, pageSize: 100 })).toBe(400);
  });

  // A negative skip reaches Prisma as `Argument skip cannot be negative` — an error naming the
  // driver, not the caller that passed page 0.
  it('clamps page below 1 up to the first page rather than emitting a negative skip', () => {
    expect(paginationSkip({ page: 0, pageSize: 20 })).toBe(0);
    expect(paginationSkip({ page: -5, pageSize: 20 })).toBe(0);
  });

  it('clamps a negative pageSize to zero', () => {
    expect(paginationSkip({ page: 3, pageSize: -10 })).toBe(0);
  });

  it('truncates fractional input to whole rows', () => {
    expect(paginationSkip({ page: 2.9, pageSize: 20 })).toBe(20);
    expect(paginationSkip({ page: 3, pageSize: 10.7 })).toBe(20);
  });

  it('falls back to a safe skip for non-finite input', () => {
    expect(paginationSkip({ page: Number.NaN, pageSize: 20 })).toBe(0);
    expect(paginationSkip({ page: Number.POSITIVE_INFINITY, pageSize: 20 })).toBe(0);
    expect(paginationSkip({ page: 2, pageSize: Number.NaN })).toBe(0);
  });
});

describe('buildPageMeta', () => {
  it('reports totalPages and neighbour flags for a middle page', () => {
    expect(buildPageMeta(2, 10, 35)).toEqual({
      page: 2,
      pageSize: 10,
      total: 35,
      totalPages: 4,
      hasPrevPage: true,
      hasNextPage: true,
    });
  });

  it('reports a single page when there are no rows', () => {
    const meta = buildPageMeta(1, 10, 0);
    expect(meta.totalPages).toBe(1);
    expect(meta.hasPrevPage).toBe(false);
    expect(meta.hasNextPage).toBe(false);
  });

  it('marks the last page as having no next page', () => {
    const meta = buildPageMeta(4, 10, 35);
    expect(meta.hasNextPage).toBe(false);
    expect(meta.hasPrevPage).toBe(true);
  });
});
