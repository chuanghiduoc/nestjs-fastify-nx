import { describe, expect, it } from 'vitest';
import { escapeLikePattern, jsonObjectOrEmpty } from './query-helpers';

describe('escapeLikePattern', () => {
  it('escapes every LIKE metacharacter', () => {
    expect(escapeLikePattern('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});

describe('jsonObjectOrEmpty', () => {
  it('keeps a JSON object', () => {
    expect(jsonObjectOrEmpty({ a: 1 })).toEqual({ a: 1 });
  });

  it.each([null, [1], 'text', 3])('falls back to an empty object for %j', (raw) => {
    expect(jsonObjectOrEmpty(raw)).toEqual({});
  });
});
