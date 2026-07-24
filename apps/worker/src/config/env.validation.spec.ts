import { describe, expect, it } from 'vitest';
import { validateWorkerConfig } from './env.validation';

describe('validateWorkerConfig', () => {
  it('rejects development storage credentials and placeholder sender in production', () => {
    expect(() => validateWorkerConfig({ NODE_ENV: 'production' })).toThrow(
      'Worker environment validation failed',
    );
  });

  it('accepts non-default production storage and sender configuration', () => {
    const config = validateWorkerConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@db:5432/app',
      STORAGE_ACCESS_KEY: 'production-key',
      STORAGE_SECRET_KEY: 'production-secret',
      MAIL_HOST: 'smtp.company.example',
      MAIL_DEFAULT_EMAIL: 'noreply@company.example',
    });

    expect(config.STORAGE_ACCESS_KEY).toBe('production-key');
    expect(config.MAIL_DEFAULT_EMAIL).toBe('noreply@company.example');
  });

  it('rejects the default MAIL_HOST (localhost) in production — the worker is the mail sender', () => {
    expect(() =>
      validateWorkerConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@db:5432/app',
        STORAGE_ACCESS_KEY: 'production-key',
        STORAGE_SECRET_KEY: 'production-secret',
        MAIL_DEFAULT_EMAIL: 'noreply@company.example',
        // MAIL_HOST omitted → defaults to 'localhost'
      }),
    ).toThrow(/MAIL_HOST/);
  });

  it('requires a database URL for durable upload lifecycle state', () => {
    expect(() => validateWorkerConfig({ NODE_ENV: 'development' })).toThrow('DATABASE_URL');
  });
});
