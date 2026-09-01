import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertHttpLink, buildSocialProviders, resolveFrontendBase } from './better-auth.config';

const OAUTH_KEYS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'FACEBOOK_CLIENT_ID',
  'FACEBOOK_CLIENT_SECRET',
] as const;

describe('buildSocialProviders', () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of OAUTH_KEYS) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of OAUTH_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it('returns no providers when nothing is configured', () => {
    expect(buildSocialProviders()).toEqual({});
  });

  it('enables a provider only when both id and secret are set', () => {
    process.env['GOOGLE_CLIENT_ID'] = 'gid';
    process.env['GOOGLE_CLIENT_SECRET'] = 'gsecret';

    expect(buildSocialProviders()).toEqual({
      google: { clientId: 'gid', clientSecret: 'gsecret' },
    });
  });

  it('leaves a provider disabled when only the id is set', () => {
    process.env['GITHUB_CLIENT_ID'] = 'ghid';

    expect(buildSocialProviders()).toEqual({});
  });

  it('trims surrounding whitespace and treats blank as unset', () => {
    process.env['FACEBOOK_CLIENT_ID'] = '  fbid  ';
    process.env['FACEBOOK_CLIENT_SECRET'] = '   ';

    expect(buildSocialProviders()).toEqual({});
  });

  it('enables every provider that is fully configured', () => {
    process.env['GOOGLE_CLIENT_ID'] = 'gid';
    process.env['GOOGLE_CLIENT_SECRET'] = 'gsecret';
    process.env['GITHUB_CLIENT_ID'] = 'ghid';
    process.env['GITHUB_CLIENT_SECRET'] = 'ghsecret';
    process.env['FACEBOOK_CLIENT_ID'] = 'fbid';
    process.env['FACEBOOK_CLIENT_SECRET'] = 'fbsecret';

    expect(buildSocialProviders()).toEqual({
      google: { clientId: 'gid', clientSecret: 'gsecret' },
      github: { clientId: 'ghid', clientSecret: 'ghsecret' },
      facebook: { clientId: 'fbid', clientSecret: 'fbsecret' },
    });
  });
});

describe('assertHttpLink', () => {
  it('passes http and https links through unchanged', () => {
    for (const link of [
      'https://app.example.com/reset?token=abc',
      'http://localhost:3000/verify-email?token=abc',
    ]) {
      expect(assertHttpLink(link)).toBe(link);
    }
  });

  // escapeHtml cannot save an href here: `javascript:alert(1)` contains none of the five characters
  // it escapes, so the scheme has to be rejected before the link reaches the template.
  it('rejects a scheme that escaping would leave intact', () => {
    for (const link of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ]) {
      expect(() => assertHttpLink(link)).toThrow(/Refusing to embed/);
    }
  });

  it('rejects an unparseable link', () => {
    expect(() => assertHttpLink('not a url')).toThrow(/unparseable/);
  });

  // The link carries a single-use reset/verification token — it must never reach a log or a message.
  it('never puts the link itself in the error message', () => {
    const link = 'javascript:steal("super-secret-token")';
    expect(() => assertHttpLink(link)).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('super-secret-token') }),
    );
  });
});

describe('resolveFrontendBase', () => {
  const BASE_KEYS = ['FRONTEND_BASE_URL', 'BETTER_AUTH_URL', 'NODE_ENV', 'PORT'] as const;
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of BASE_KEYS) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of BASE_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it('prefers FRONTEND_BASE_URL and strips trailing slashes', () => {
    process.env['FRONTEND_BASE_URL'] = 'https://app.example.com//';
    expect(resolveFrontendBase()).toBe('https://app.example.com');
  });

  it('throws in production when FRONTEND_BASE_URL is missing', () => {
    delete process.env['FRONTEND_BASE_URL'];
    process.env['NODE_ENV'] = 'production';
    expect(() => resolveFrontendBase()).toThrow(/FRONTEND_BASE_URL must be set in production/);
  });

  // .env.example ships BETTER_AUTH_URL empty, so the dev fallback has to invent an absolute origin:
  // a relative base makes every email link unfollowable and assertHttpLink rejects it.
  it('falls back to an absolute local origin when BETTER_AUTH_URL is empty in dev', () => {
    delete process.env['FRONTEND_BASE_URL'];
    process.env['NODE_ENV'] = 'development';
    process.env['BETTER_AUTH_URL'] = '';
    process.env['PORT'] = '4000';

    const base = resolveFrontendBase();

    expect(base).toBe('http://localhost:4000');
    expect(() => assertHttpLink(`${base}/reset?token=abc`)).not.toThrow();
  });

  it('uses BETTER_AUTH_URL as the dev fallback when it is set', () => {
    delete process.env['FRONTEND_BASE_URL'];
    process.env['NODE_ENV'] = 'development';
    process.env['BETTER_AUTH_URL'] = 'http://localhost:3000/';
    expect(resolveFrontendBase()).toBe('http://localhost:3000');
  });
});
