import { describe, it, expect } from 'vitest';
import { DomainException, isDomainException } from './domain.exception';

const violation = { path: 'id', code: 'not_a_uuid', message: 'id must be a UUID' };

describe('DomainException', () => {
  it('carries no HTTP coupling so it stays meaningful outside the api process', () => {
    const error = new DomainException({ violations: [violation] });

    expect(error).toBeInstanceOf(Error);
    expect('getStatus' in error).toBe(false);
    expect('status' in error).toBe(false);
  });

  it('defaults to a permanent validation failure', () => {
    const error = new DomainException({ violations: [violation] });

    expect(error.kind).toBe('validation');
    expect(error.permanent).toBe(true);
    expect(error.code).toBe('business_rule_violation');
  });

  // A retryable conflict is the one case a consumer should not park.
  it('allows a conflict to be marked retryable', () => {
    const error = new DomainException({
      kind: 'conflict',
      permanent: false,
      violations: [violation],
    });

    expect(error.kind).toBe('conflict');
    expect(error.permanent).toBe(false);
  });

  it('uses the first violation as the Error message so plain logs stay legible', () => {
    expect(new DomainException({ violations: [violation] }).message).toBe('id must be a UUID');
    expect(new DomainException({ code: 'no_violations', violations: [] }).message).toBe(
      'no_violations',
    );
  });

  it('narrows unknown errors', () => {
    expect(isDomainException(new DomainException({ violations: [violation] }))).toBe(true);
    expect(isDomainException(new Error('boom'))).toBe(false);
    expect(isDomainException(undefined)).toBe(false);
  });
});
