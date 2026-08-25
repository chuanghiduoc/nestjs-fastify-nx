import { describe, expect, it } from 'vitest';
import {
  isCompilableTrustedProxyList,
  parseTrustedProxies,
  resolveTrustedProxies,
} from './trusted-proxies';

describe('parseTrustedProxies', () => {
  it('returns an empty list when the variable is unset', () => {
    expect(parseTrustedProxies(undefined)).toEqual([]);
  });

  // `TRUST_PROXY_CIDRS=` in a .env file arrives as "", not undefined.
  it('returns an empty list for a set-but-empty value', () => {
    expect(parseTrustedProxies('')).toEqual([]);
  });

  it('trims entries and drops empty ones', () => {
    expect(parseTrustedProxies(' 10.0.0.0/8 , ,172.16.0.0/12,')).toEqual([
      '10.0.0.0/8',
      '172.16.0.0/12',
    ]);
  });
});

describe('isCompilableTrustedProxyList', () => {
  it('accepts an empty list', () => {
    expect(isCompilableTrustedProxyList([])).toBe(true);
  });

  it.each([['10.0.0.10'], ['10.0.0.0/8'], ['loopback'], ['uniquelocal'], ['::1']])(
    'accepts %s',
    (entry) => {
      expect(isCompilableTrustedProxyList([entry])).toBe(true);
    },
  );

  it.each([['not-an-ip'], ['10.0.0.0/99'], ['10.0.0.0-10.0.0.5']])('rejects %s', (entry) => {
    expect(isCompilableTrustedProxyList([entry])).toBe(false);
  });

  it('rejects a list where only one entry is malformed', () => {
    expect(isCompilableTrustedProxyList(['10.0.0.0/8', 'not-an-ip'])).toBe(false);
  });
});

describe('resolveTrustedProxies', () => {
  it('returns the parsed list when every entry compiles', () => {
    expect(resolveTrustedProxies('10.0.0.0/8, loopback')).toEqual(['10.0.0.0/8', 'loopback']);
  });

  // Fail closed: an unparseable list must not reach proxy-addr, so the adapter boots trusting
  // nothing and ConfigModule reports the invalid value instead of proxy-addr throwing.
  it('returns an empty list when any entry is malformed', () => {
    expect(resolveTrustedProxies('10.0.0.0/8, not-an-ip')).toEqual([]);
  });
});
