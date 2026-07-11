import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSocialProviders } from './better-auth.config';

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
