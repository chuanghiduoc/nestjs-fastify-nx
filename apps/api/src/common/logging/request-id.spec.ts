import { describe, expect, it } from 'vitest';
import { resolveRequestId, sanitizeClientId } from './request-id';

describe('sanitizeClientId', () => {
  it('accepts a well-formed opaque id', () => {
    expect(sanitizeClientId('req_01HZY8ABCD.efgh-1234~xyz')).toBe('req_01HZY8ABCD.efgh-1234~xyz');
  });

  it('accepts a 32-hex trace id', () => {
    const traceId = 'a'.repeat(32);
    expect(sanitizeClientId(traceId)).toBe(traceId);
  });

  it.each([
    ['newline (log-injection vector)', 'abc\nlevel=50 msg=forged'],
    ['carriage return', 'abc\rdef'],
    ['tab', 'abc\tdef'],
    ['space', 'abc def'],
    ['slash', 'abc/def'],
    ['empty string', ''],
  ])('rejects %s', (_label, value) => {
    expect(sanitizeClientId(value)).toBeUndefined();
  });

  it('rejects an over-length id (> 128 chars) to bound log/trace storage', () => {
    expect(sanitizeClientId('x'.repeat(129))).toBeUndefined();
  });

  it('accepts an id at the 128-char boundary', () => {
    expect(sanitizeClientId('x'.repeat(128))).toHaveLength(128);
  });

  it.each([[undefined], [null], [42], [{}], [['a']]])('rejects non-string %s', (value) => {
    expect(sanitizeClientId(value)).toBeUndefined();
  });
});

describe('resolveRequestId', () => {
  it('returns the client x-request-id when it is well-formed', () => {
    expect(resolveRequestId({ 'x-request-id': 'req_valid-123' })).toBe('req_valid-123');
  });

  it('never returns a poisoned client id — mints a fresh one instead', () => {
    const poisoned = 'abc\ninjected-log-line';
    const resolved = resolveRequestId({ 'x-request-id': poisoned });

    expect(resolved).not.toBe(poisoned);
    expect(resolved).not.toContain('\n');
    expect(resolved.length).toBeGreaterThan(0);
  });

  it('mints a fresh id when no client header is present', () => {
    const a = resolveRequestId({});
    const b = resolveRequestId({});

    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
