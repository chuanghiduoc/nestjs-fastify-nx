import { describe, it, expect, afterEach, vi } from 'vitest';
import { SESSION_COOKIE_BASE, sessionCookieName, usesSecureCookies } from './session-cookie';

describe('session cookie naming', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('adds the __Secure- prefix in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(usesSecureCookies(undefined)).toBe(true);
    expect(sessionCookieName(undefined)).toBe(`__Secure-${SESSION_COOKIE_BASE}`);
  });

  // An https staging deploy runs with NODE_ENV != production but still gets secure cookies.
  it('keys on the baseURL protocol, not NODE_ENV alone', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(sessionCookieName('https://staging.example.com')).toBe(
      `__Secure-${SESSION_COOKIE_BASE}`,
    );
    expect(sessionCookieName('http://localhost:3000')).toBe(SESSION_COOKIE_BASE);
    expect(sessionCookieName(undefined)).toBe(SESSION_COOKIE_BASE);
  });
});
