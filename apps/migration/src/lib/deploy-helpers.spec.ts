import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  boundedIntEnv,
  injectDatabasePassword,
  isRetryableDeployError,
  runWithRetry,
} from './deploy-helpers';

describe('boundedIntEnv', () => {
  it('reads an in-range integer', () => {
    expect(boundedIntEnv('X', 5, 1, 10, { X: '7' })).toBe(7);
  });

  it('falls back outside the range or for non-integers', () => {
    expect(boundedIntEnv('X', 5, 1, 10, { X: '0' })).toBe(5);
    expect(boundedIntEnv('X', 5, 1, 10, { X: '11' })).toBe(5);
    expect(boundedIntEnv('X', 5, 1, 10, { X: '2.5' })).toBe(5);
    expect(boundedIntEnv('X', 5, 1, 10, {})).toBe(5);
  });
});

describe('injectDatabasePassword', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function passwordFile(contents: string): string {
    dir = mkdtempSync(join(tmpdir(), 'migration-password-'));
    const file = join(dir, 'password');
    writeFileSync(file, contents, 'utf8');
    return file;
  }

  it('injects a percent-containing password encoded exactly once', () => {
    const raw = ['p', '%40', 'ss'].join('');
    const file = passwordFile(raw);

    const result = injectDatabasePassword('postgresql://app:@db:5432/app', file);

    expect(result).toBe('postgresql://app:p%2540ss@db:5432/app');
  });

  it('leaves a URL with an existing password untouched', () => {
    const file = passwordFile('other');

    expect(injectDatabasePassword('postgresql://app:present@db:5432/app', file)).toBe(
      'postgresql://app:present@db:5432/app',
    );
  });

  it('ignores non-postgres URLs and missing password files', () => {
    const file = passwordFile('secret');

    expect(injectDatabasePassword('mysql://app:@db:3306/app', file)).toBe(
      'mysql://app:@db:3306/app',
    );
    expect(injectDatabasePassword('postgresql://app:@db:5432/app', 'missing-file')).toBe(
      'postgresql://app:@db:5432/app',
    );
  });

  it('returns the input unchanged when no URL is configured', () => {
    expect(injectDatabasePassword(undefined, 'whatever')).toBeUndefined();
  });
});

describe('isRetryableDeployError', () => {
  it('retries connection-class failures only', () => {
    expect(isRetryableDeployError(new Error('P1001: cannot reach database server'))).toBe(true);
    expect(isRetryableDeployError(new Error('ECONNREFUSED 127.0.0.1:5432'))).toBe(true);
    expect(isRetryableDeployError(new Error('migration failed: syntax error'))).toBe(false);
  });
});

describe('runWithRetry', () => {
  it('retries a transient failure and then succeeds', async () => {
    const run = vi.fn();
    run.mockImplementationOnce(() => {
      throw new Error('P1001: cannot reach database server');
    });
    const log = vi.fn();

    await runWithRetry('deploy', 'deploy', 3, 1, run, log, isRetryableDeployError);

    expect(run).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('retrying'));
  });

  it('does not retry a deterministic failure', async () => {
    const run = vi.fn(() => {
      throw new Error('syntax error at or near');
    });

    await expect(
      runWithRetry('deploy', 'deploy', 5, 1, run, undefined, isRetryableDeployError),
    ).rejects.toThrow('syntax error');

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('rethrows the last failure after exhausting the budget', async () => {
    const run = vi.fn(() => {
      throw new Error('ECONNREFUSED');
    });

    await expect(
      runWithRetry('deploy', 'deploy', 2, 1, run, undefined, isRetryableDeployError),
    ).rejects.toThrow('ECONNREFUSED');

    expect(run).toHaveBeenCalledTimes(2);
  });
});
