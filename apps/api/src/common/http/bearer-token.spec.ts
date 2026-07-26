import { describe, expect, it } from 'vitest';
import { extractBearerToken } from './bearer-token';

describe('extractBearerToken', () => {
  // RFC 9110 §11.1 makes the scheme case-insensitive, and Better Auth's bearer plugin implements
  // that (`authHeader.slice(0, 7).toLowerCase() !== 'bearer '`). A parser that only accepted
  // `Bearer ` would disagree with the plugin about who the caller is.
  it.each([['Bearer'], ['bearer'], ['BEARER'], ['BeArEr']])(
    'accepts the %s scheme spelling',
    (scheme) => {
      expect(extractBearerToken(`${scheme} tok_123`)).toBe('tok_123');
    },
  );

  it('trims surrounding whitespace from the credential, as the plugin does', () => {
    expect(extractBearerToken('Bearer   tok_123  ')).toBe('tok_123');
  });

  it('takes the first value when the header arrives repeated', () => {
    expect(extractBearerToken(['Bearer first', 'Bearer second'])).toBe('first');
  });

  // Better Auth compares a fixed 7-character slice against 'bearer ', so a tab separator never
  // matches there. Accepting it here (as a `\s+` regex would) makes this parser authenticate a
  // request the plugin rejects — the two must stay in step.
  it('rejects a tab separator, matching the plugin exactly', () => {
    expect(extractBearerToken('Bearer\ttok_123')).toBeUndefined();
  });

  it.each([
    ['a different scheme', 'Basic dXNlcjpwYXNz'],
    ['a scheme with no credential', 'Bearer '],
    ['a scheme with only whitespace', 'Bearer    '],
    ['the bare scheme', 'Bearer'],
    ['an empty header', ''],
  ])('returns undefined for %s', (_label, header) => {
    expect(extractBearerToken(header)).toBeUndefined();
  });

  it.each([[undefined], [[]]])('returns undefined for an absent header (%s)', (header) => {
    expect(extractBearerToken(header as string[] | undefined)).toBeUndefined();
  });
});
