import { describe, it, expect, afterEach } from 'vitest';
import type { Options as PinoHttpOptions } from 'pino-http';
import { buildPinoLoggerConfig } from './pino-logger-config';

function pinoHttp(overrides = {}): PinoHttpOptions {
  return buildPinoLoggerConfig(overrides).pinoHttp as PinoHttpOptions;
}

describe('buildPinoLoggerConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('stamps service, env, pid and hostname on every line', () => {
    process.env['OTEL_SERVICE_NAME'] = 'api';
    process.env['NODE_ENV'] = 'production';
    const base = pinoHttp().base as Record<string, unknown>;
    expect(base['service']).toBe('api');
    expect(base['env']).toBe('production');
    expect(base['pid']).toBe(process.pid);
    expect(typeof base['hostname']).toBe('string');
  });

  it('ignores health and metrics probes but logs real traffic', () => {
    const ignore = (pinoHttp().autoLogging as { ignore: (req: { url?: string }) => boolean })
      .ignore;
    expect(ignore({ url: '/metrics' })).toBe(true);
    expect(ignore({ url: '/api/v1/health/live' })).toBe(true);
    expect(ignore({ url: '/api/v1/health/ready?probe=1' })).toBe(true);
    expect(ignore({ url: '/api/v1/users/me' })).toBe(false);
    expect(ignore({ url: undefined })).toBe(false);
  });

  it('emits the string level label only in production (dev keeps numeric for pino-pretty)', () => {
    process.env['NODE_ENV'] = 'production';
    const prodFormatters = pinoHttp().formatters as { level: (l: string) => object };
    expect(prodFormatters.level('info')).toEqual({ level: 'info' });

    process.env['NODE_ENV'] = 'development';
    expect(pinoHttp().formatters).toBeUndefined();
  });

  it('trims request/response serializers to essentials', () => {
    const serializers = pinoHttp().serializers as {
      req: (r: object) => object;
      res: (r: object) => object;
    };
    expect(
      serializers.req({
        method: 'GET',
        url: '/api/v1/users/me',
        remoteAddress: '1.2.3.4',
        headers: { authorization: 'secret' },
      }),
    ).toEqual({ method: 'GET', url: '/api/v1/users/me', remoteAddress: '1.2.3.4' });
    expect(serializers.res({ statusCode: 200, headers: {} })).toEqual({ statusCode: 200 });
  });

  it('applies the sensitive redaction list and lets callers override', () => {
    const redact = pinoHttp().redact as { paths: string[]; censor: string };
    expect(redact.paths).toContain('*.sessionToken');
    expect(redact.censor).toBe('[REDACTED]');

    const custom = pinoHttp({ level: 'debug' });
    expect(custom.level).toBe('debug');
  });
});
