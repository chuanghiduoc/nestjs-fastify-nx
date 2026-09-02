import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const { execFileSyncMock } = vi.hoisted(() => ({ execFileSyncMock: vi.fn() }));

vi.mock('node:child_process', () => ({ execFileSync: execFileSyncMock }));

import { buildMigrationEnv, deployTestMigrations } from './deploy-test-migrations';

const TEST_DB_URL = 'postgresql://test:test@127.0.0.1:54329/nestjs_test';

describe('buildMigrationEnv', () => {
  it('points both DATABASE_URL and DATABASE_DIRECT_URL at the test database', () => {
    const env = buildMigrationEnv(
      {
        DATABASE_URL: 'postgresql://dev:dev@localhost:6432/dev_pooled',
        DATABASE_DIRECT_URL: 'postgresql://dev:dev@localhost:5432/dev_direct',
      },
      TEST_DB_URL,
    );

    expect(env['DATABASE_URL']).toBe(TEST_DB_URL);
    expect(env['DATABASE_DIRECT_URL']).toBe(TEST_DB_URL);
    expect(env['PRISMA_HIDE_UPDATE_MESSAGE']).toBe('true');
  });

  it('drops DB_PASSWORD_FILE so the secret-file indirection cannot rewrite the test DSN', () => {
    const env = buildMigrationEnv({ DB_PASSWORD_FILE: '/run/secrets/db_password' }, TEST_DB_URL);

    expect(env).not.toHaveProperty('DB_PASSWORD_FILE');
  });

  it('keeps unrelated variables and leaves the caller environment untouched', () => {
    const base: NodeJS.ProcessEnv = { PATH: '/usr/bin', DB_PASSWORD_FILE: '/run/secrets/x' };

    const env = buildMigrationEnv(base, TEST_DB_URL);

    expect(env['PATH']).toBe('/usr/bin');
    expect(base['DB_PASSWORD_FILE']).toBe('/run/secrets/x');
  });
});

describe('deployTestMigrations', () => {
  it('runs prisma migrate deploy with the isolated environment', () => {
    vi.stubEnv('DATABASE_DIRECT_URL', 'postgresql://dev:dev@localhost:5432/dev_direct');
    vi.stubEnv('DB_PASSWORD_FILE', '/run/secrets/db_password');
    execFileSyncMock.mockReset();

    deployTestMigrations(TEST_DB_URL);

    expect(execFileSyncMock).toHaveBeenCalledOnce();
    const [command, args, options] = execFileSyncMock.mock.calls[0] as [
      string,
      string[],
      { env: NodeJS.ProcessEnv; cwd: string },
    ];
    expect(command).toBe(process.execPath);
    expect(args.slice(-2)).toEqual(['migrate', 'deploy']);
    expect(options.env['DATABASE_URL']).toBe(TEST_DB_URL);
    expect(options.env['DATABASE_DIRECT_URL']).toBe(TEST_DB_URL);
    expect(options.env).not.toHaveProperty('DB_PASSWORD_FILE');
    expect(existsSync(join(options.cwd, 'prisma', 'schema.prisma'))).toBe(true);

    vi.unstubAllEnvs();
  });
});
