import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HealthCheckError } from '@nestjs/terminus';
import type { ClientConfig } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PgBouncerHealthIndicator,
  type PgClientFactory,
  type PgClientLike,
} from './pgbouncer-health.indicator';

// Build a controlled stub client. Each test resets individual methods via mockReset().
function makeClientStub(): PgClientLike {
  return {
    connect: vi.fn(),
    query: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
  };
}

describe('PgBouncerHealthIndicator', () => {
  let clientStub: PgClientLike;
  let factorySpy: ReturnType<typeof vi.fn<PgClientFactory>>;
  let indicator: PgBouncerHealthIndicator;

  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    clientStub = makeClientStub();
    factorySpy = vi.fn<PgClientFactory>(() => clientStub);
    // Inject a factory that always returns the same stub — no pg module needed.
    indicator = new PgBouncerHealthIndicator(factorySpy);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns skipped status when DATABASE_DIRECT_URL is not set', async () => {
    delete process.env['DATABASE_DIRECT_URL'];

    const result = await indicator.isHealthy('pgbouncer');

    expect(result).toMatchObject({
      pgbouncer: { status: 'up', skipped: true },
    });
    // Factory should never have been called — probe is disabled.
    expect(clientStub.connect).not.toHaveBeenCalled();
  });

  it('returns healthy status when the pooler responds to SELECT 1', async () => {
    process.env['DATABASE_DIRECT_URL'] = 'postgresql://postgres:postgres@postgres:5432/nestjs_db';
    process.env['DATABASE_URL'] = 'postgresql://postgres:postgres@pgbouncer:6432/nestjs_db';

    (clientStub.connect as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (clientStub.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [{ '?column?': 1 }] });

    const result = await indicator.isHealthy('pgbouncer');

    expect(result).toMatchObject({ pgbouncer: { status: 'up' } });
    expect(clientStub.connect).toHaveBeenCalledOnce();
    expect(clientStub.query).toHaveBeenCalledWith('SELECT 1');
    expect(clientStub.end).toHaveBeenCalledOnce();
  });

  it('throws HealthCheckError when the pooler connection fails', async () => {
    process.env['DATABASE_DIRECT_URL'] = 'postgresql://postgres:postgres@postgres:5432/nestjs_db';
    process.env['DATABASE_URL'] = 'postgresql://postgres:postgres@pgbouncer:6432/nestjs_db';

    (clientStub.connect as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('ECONNREFUSED — pgbouncer is down'),
    );

    await expect(indicator.isHealthy('pgbouncer')).rejects.toThrow(HealthCheckError);
    // end() must still be called in the finally block even when connect() throws.
    expect(clientStub.end).toHaveBeenCalledOnce();
  });

  it('throws HealthCheckError when query fails after a successful connect', async () => {
    process.env['DATABASE_DIRECT_URL'] = 'postgresql://postgres:postgres@postgres:5432/nestjs_db';
    process.env['DATABASE_URL'] = 'postgresql://postgres:postgres@pgbouncer:6432/nestjs_db';

    (clientStub.connect as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (clientStub.query as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('prepared statement does not exist'),
    );

    await expect(indicator.isHealthy('pgbouncer')).rejects.toThrow(HealthCheckError);
    expect(clientStub.end).toHaveBeenCalledOnce();
  });

  it('does not surface end() errors — outer HealthCheckError takes precedence', async () => {
    process.env['DATABASE_DIRECT_URL'] = 'postgresql://postgres:postgres@postgres:5432/nestjs_db';
    process.env['DATABASE_URL'] = 'postgresql://postgres:postgres@pgbouncer:6432/nestjs_db';

    (clientStub.connect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('timeout'));
    // end() also fails — the finally block swallows it via .catch(() => undefined).
    (clientStub.end as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('socket already closed'),
    );

    // Must reject with HealthCheckError, not the end() error.
    await expect(indicator.isHealthy('pgbouncer')).rejects.toThrow(HealthCheckError);
  });

  // Docker-secrets / k8s deployments mount the password as a file and publish
  // DATABASE_URL without a password segment. The probe MUST mirror PrismaService
  // here, otherwise /health/ready 503s under the documented prod overlay.
  describe('DB_PASSWORD_FILE injection', () => {
    let workdir: string;
    let passwordFile: string;

    beforeAll(() => {
      workdir = mkdtempSync(join(tmpdir(), 'pgb-probe-'));
      passwordFile = join(workdir, 'pgb_password');
      writeFileSync(passwordFile, 'super-secret\n');
    });

    afterAll(() => {
      rmSync(workdir, { recursive: true, force: true });
    });

    it('reads DB_PASSWORD_FILE and injects the password into the connectionString', async () => {
      process.env['DATABASE_DIRECT_URL'] = 'postgresql://postgres@postgres:5432/nestjs_db';
      // Password-less URL — matches examples/pgbouncer/compose.pgbouncer.prod.yml.
      process.env['DATABASE_URL'] = 'postgresql://postgres@pgbouncer:6432/nestjs_db';
      process.env['DB_PASSWORD_FILE'] = passwordFile;

      (clientStub.connect as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (clientStub.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

      await indicator.isHealthy('pgbouncer');

      const config = factorySpy.mock.calls[0]?.[0] as ClientConfig;
      expect(config.connectionString).toBe(
        'postgresql://postgres:super-secret@pgbouncer:6432/nestjs_db',
      );
    });

    it('leaves URLs that already contain a password untouched', async () => {
      process.env['DATABASE_DIRECT_URL'] = 'postgresql://postgres:inline@postgres:5432/nestjs_db';
      process.env['DATABASE_URL'] = 'postgresql://postgres:inline@pgbouncer:6432/nestjs_db';
      process.env['DB_PASSWORD_FILE'] = passwordFile;

      (clientStub.connect as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (clientStub.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

      await indicator.isHealthy('pgbouncer');

      const config = factorySpy.mock.calls[0]?.[0] as ClientConfig;
      expect(config.connectionString).toBe('postgresql://postgres:inline@pgbouncer:6432/nestjs_db');
    });

    it('no-ops when DB_PASSWORD_FILE is unset (dev / CI inline credentials path)', async () => {
      process.env['DATABASE_DIRECT_URL'] = 'postgresql://postgres:postgres@postgres:5432/nestjs_db';
      process.env['DATABASE_URL'] = 'postgresql://postgres:postgres@pgbouncer:6432/nestjs_db';
      delete process.env['DB_PASSWORD_FILE'];

      (clientStub.connect as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (clientStub.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

      await indicator.isHealthy('pgbouncer');

      const config = factorySpy.mock.calls[0]?.[0] as ClientConfig;
      expect(config.connectionString).toBe(
        'postgresql://postgres:postgres@pgbouncer:6432/nestjs_db',
      );
    });
  });
});
