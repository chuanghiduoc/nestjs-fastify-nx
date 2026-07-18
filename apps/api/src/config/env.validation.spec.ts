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
  BETTER_AUTH_URL: 'https://api.example.com',
  FRONTEND_BASE_URL: 'https://app.example.com',
  BULL_BOARD_PASSWORD: 'strong-pw',
  MAIL_IGNORE_TLS: 'false',
  MAIL_REQUIRE_TLS: 'true',
};

describe('validateConfig', () => {
  it('accepts a valid development environment', () => {
    expect(() => validateConfig(baseDevEnv)).not.toThrow();
  });

  it('rejects a missing DATABASE_URL', () => {
    const { DATABASE_URL: _url, ...rest } = baseDevEnv;
    expect(() => validateConfig(rest)).toThrow();
  });

  it('applies default values for optional fields', () => {
    const result = validateConfig(baseDevEnv);
    expect(result.REDIS_CACHE_HOST).toBe('localhost');
    expect(result.REDIS_CACHE_PORT).toBe(6379);
  });

  it('applies safe defaults for auth rate-limit and body-limit caps', () => {
    const result = validateConfig(baseDevEnv);
    expect(result.AUTH_RATE_LIMIT_MAX).toBe(5);
    expect(result.AUTH_IP_RATE_LIMIT_MAX).toBe(50);
    expect(result.AUTH_RATE_LIMIT_WINDOW_MS).toBe(900_000);
    expect(result.AUTH_RATE_LIMIT_FAIL_OPEN).toBe(false);
    expect(result.HTTP_BODY_LIMIT_BYTES).toBe(1_048_576);
    expect(result.UPLOAD_MAX_FILE_BYTES).toBe(10_485_760);
  });

  it('accepts custom auth rate-limit and body-limit values', () => {
    const result = validateConfig({
      ...baseDevEnv,
      AUTH_RATE_LIMIT_MAX: '10',
      AUTH_RATE_LIMIT_WINDOW_MS: '60000',
      HTTP_BODY_LIMIT_BYTES: '2097152',
      UPLOAD_MAX_FILE_BYTES: '20971520',
    });
    expect(result.AUTH_RATE_LIMIT_MAX).toBe(10);
    expect(result.AUTH_RATE_LIMIT_WINDOW_MS).toBe(60_000);
    expect(result.HTTP_BODY_LIMIT_BYTES).toBe(2_097_152);
    expect(result.UPLOAD_MAX_FILE_BYTES).toBe(20_971_520);
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

  it('rejects MAIL_IGNORE_TLS=true in production when MAIL_USER is set', () => {
    expect(() =>
      validateConfig({ ...baseProdEnv, MAIL_USER: 'smtp-user', MAIL_IGNORE_TLS: 'true' }),
    ).toThrow(/MAIL_IGNORE_TLS/);
  });

  it('requires MAIL_SECURE or MAIL_REQUIRE_TLS in production when MAIL_USER is set', () => {
    expect(() =>
      validateConfig({
        ...baseProdEnv,
        MAIL_USER: 'smtp-user',
        MAIL_SECURE: 'false',
        MAIL_REQUIRE_TLS: 'false',
      }),
    ).toThrow(/MAIL_REQUIRE_TLS/);
  });

  it('allows plaintext SMTP in production when MAIL_USER is unset (no credentials to leak)', () => {
    // A no-auth relay (e.g. a local Mailpit in the prod-parity smoke) sends nothing
    // secret in plaintext, so the TLS requirement does not apply.
    expect(() =>
      validateConfig({
        ...baseProdEnv,
        MAIL_USER: '',
        MAIL_IGNORE_TLS: 'true',
        MAIL_SECURE: 'false',
        MAIL_REQUIRE_TLS: 'false',
      }),
    ).not.toThrow();
  });

  it('rejects default bull board password in production', () => {
    expect(() => validateConfig({ ...baseProdEnv, BULL_BOARD_PASSWORD: 'admin' })).toThrow(
      /BULL_BOARD_PASSWORD/,
    );
  });

  it('rejects missing BETTER_AUTH_SECRET in production', () => {
    const { BETTER_AUTH_SECRET: _s, ...rest } = baseProdEnv;
    expect(() => validateConfig(rest)).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('rejects empty BETTER_AUTH_SECRET in production (treated as unset)', () => {
    expect(() => validateConfig({ ...baseProdEnv, BETTER_AUTH_SECRET: '' })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it('requires stable API and frontend origins in production', () => {
    expect(() => validateConfig({ ...baseProdEnv, BETTER_AUTH_URL: '' })).toThrow(
      /BETTER_AUTH_URL/,
    );
    expect(() => validateConfig({ ...baseProdEnv, FRONTEND_BASE_URL: '' })).toThrow(
      /FRONTEND_BASE_URL/,
    );
  });

  it('rejects too-short BETTER_AUTH_SECRET (<32 chars) in development', () => {
    expect(() => validateConfig({ ...baseDevEnv, BETTER_AUTH_SECRET: 'short' })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it('treats empty BETTER_AUTH_URL as unset (not as a malformed url)', () => {
    expect(() => validateConfig({ ...baseDevEnv, BETTER_AUTH_URL: '' })).not.toThrow();
  });

  it('accepts a valid production environment', () => {
    expect(() => validateConfig(baseProdEnv)).not.toThrow();
  });
});
