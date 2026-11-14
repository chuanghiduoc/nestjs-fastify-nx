import { describe, expect, it } from 'vitest';
import { ACCESS_FILTER_TRUNCATED_CODE } from '@nestjs-fastify-nx/shared';
import { isDomainException } from '../errors/domain.exception';
import { applyAccessFilter } from './access-filter';

describe('applyAccessFilter', () => {
  it('leaves the base condition untouched for an all filter', () => {
    expect(applyAccessFilter({ organizationId: 'org-1' }, { kind: 'all' })).toEqual({
      organizationId: 'org-1',
    });
  });

  it('returns null for a none filter so the caller never runs an unscoped query', () => {
    expect(applyAccessFilter({ organizationId: 'org-1' }, { kind: 'none' })).toBeNull();
  });

  it('merges predicate constraints into the base condition', () => {
    expect(
      applyAccessFilter(
        { organizationId: 'org-1' },
        { kind: 'predicate', where: { ownerId: 'u' } },
      ),
    ).toEqual({ organizationId: 'org-1', ownerId: 'u' });
  });

  it('narrows to the allowed ids', () => {
    expect(applyAccessFilter({}, { kind: 'ids', ids: ['a', 'b'], truncated: false })).toEqual({
      id: { in: ['a', 'b'] },
    });
  });

  it('returns null when the id list is empty', () => {
    expect(applyAccessFilter({}, { kind: 'ids', ids: [], truncated: false })).toBeNull();
  });

  it('throws a registered, retryable failure when the enumeration was truncated', () => {
    let caught: unknown;
    try {
      applyAccessFilter({}, { kind: 'ids', ids: ['a'], truncated: true });
    } catch (error) {
      caught = error;
    }

    expect(isDomainException(caught)).toBe(true);
    expect(caught).toMatchObject({
      kind: 'unavailable',
      code: ACCESS_FILTER_TRUNCATED_CODE,
      permanent: false,
    });
  });
});
