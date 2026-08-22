import { DomainException } from '../errors/domain.exception';
import type { AccessFilter } from './authorization.port';

export const ACCESS_FILTER_TRUNCATED_CODE = 'authorization_result_truncated';

export function accessFilterTruncated(): DomainException {
  return new DomainException({
    kind: 'conflict',
    code: ACCESS_FILTER_TRUNCATED_CODE,
    title: 'Authorization result truncated',
    permanent: false,
    violations: [
      {
        path: 'authorization',
        code: ACCESS_FILTER_TRUNCATED_CODE,
        message:
          'The authorization engine could not enumerate every permitted resource for this request',
      },
    ],
  });
}

/**
 * Folds an engine's answer into a query condition. Returns null when the caller must not run the
 * query at all — a `none` filter with an empty `WHERE` would return the whole table.
 *
 * A truncated enumeration throws rather than narrowing the page: a short list that looks complete
 * is worse than an error, because the caller cannot tell the difference.
 */
export function applyAccessFilter<TWhere extends Record<string, unknown>>(
  base: TWhere,
  filter: AccessFilter,
): TWhere | null {
  switch (filter.kind) {
    case 'all':
      return base;
    case 'none':
      return null;
    case 'predicate':
      return { ...base, ...filter.where };
    case 'ids':
      if (filter.truncated) throw accessFilterTruncated();
      if (filter.ids.length === 0) return null;
      return { ...base, id: { in: [...filter.ids] } };
  }
}
