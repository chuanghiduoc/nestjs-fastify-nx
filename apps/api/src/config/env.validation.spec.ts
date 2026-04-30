import { describe, expect, it } from 'vitest';
import { validateConfig } from './env.validation';

const baseDevEnv = {
  DATABASE_URL: 'postgresql://user:pw@localhost:5432/db',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
};

const baseProdEnv = {
  ...baseDevEnv,
  NODE_ENV: 'production',
  CORS_ORIGINS: 'https://example.com',
  MAIL_HOST: 'smtp.example.com',
  MAIL_DEFAULT_EMAIL: 'ops@example.com',
  STORAGE_ACCESS_KEY: 'real-key',
  STORAGE_SECRET_KEY: 'real-secret',
  BULL_BOARD_PASSWORD: 'strong-pw',
};

describe('validateConfig', () => {
  it('accepts a valid development environment', () => {
    expect(() => validateConfig(baseDevEnv)).not.toThrow();
  });

  it('rejects a missing DATABASE_URL', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { DATABASE_URL: _url, ...rest } = baseDevEnv;
    expect(() => validateConfig(rest)).toThrow();
  });

  it('applies default values for optional fields', () => {
    const result = validateConfig(baseDevEnv);
    expect(result.REDIS_CACHE_HOST).toBe('localhost');
    expect(result.REDIS_CACHE_PORT).toBe(6379);
  });

  it('coerces boolean THROTTLER_ENABLED from string', () => {
    const result = validateConfig({ ...baseDevEnv, THROTTLER_ENABLED: 'false' });
    expect(result.THROTTLER_ENABLED).toBe(false);
  });

  it('parses CORS_ORIGINS into string array', () => {
    const result = validateConfig({
      ...baseDevEnv,
      CORS_ORIGINS: 'http://localhost:3000,https://app.com',
    });
    expect(result.CORS_ORIGINS).toEqual(['http://localhost:3000', 'https://app.com']);
  });

  it('rejects a non-postgres DATABASE_URL in production', () => {
    expect(() => validateConfig({ ...baseProdEnv, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects default minio credentials in production', () => {
    expect(() => validateConfig({ ...baseProdEnv, STORAGE_ACCESS_KEY: 'minioadmin' })).toThrow(
      /STORAGE_ACCESS_KEY/,
    );
  });

  it('rejects default mail noreply address in production', () => {
    expect(() =>
      validateConfig({ ...baseProdEnv, MAIL_DEFAULT_EMAIL: 'noreply@example.com' }),
    ).toThrow(/MAIL_DEFAULT_EMAIL/);
  });

  it('rejects empty CORS_ORIGINS in production', () => {
    expect(() => validateConfig({ ...baseProdEnv, CORS_ORIGINS: '' })).toThrow(/CORS_ORIGINS/);
  });

  it('rejects localhost mail host in production', () => {
    expect(() => validateConfig({ ...baseProdEnv, MAIL_HOST: 'localhost' })).toThrow(/MAIL_HOST/);
  });

  it('rejects default bull board password in production', () => {
    expect(() => validateConfig({ ...baseProdEnv, BULL_BOARD_PASSWORD: 'admin' })).toThrow(
      /BULL_BOARD_PASSWORD/,
    );
  });

  it('rejects missing BETTER_AUTH_SECRET in production', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { BETTER_AUTH_SECRET: _s, ...rest } = baseProdEnv;
    expect(() => validateConfig(rest)).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('accepts a valid production environment', () => {
    expect(() => validateConfig(baseProdEnv)).not.toThrow();
  });
});
