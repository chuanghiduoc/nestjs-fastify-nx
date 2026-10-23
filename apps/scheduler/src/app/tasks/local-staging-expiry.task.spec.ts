import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { LocalStorageAdapter, type StoragePort } from '@nestjs-fastify-nx/infra-storage';
import { LocalStagingExpiryTask } from './local-staging-expiry.task';
import type { SchedulerLeaderService } from '../leadership/scheduler-leader.service';
import type { SchedulerEnvConfig } from '../../config/env.validation';

const EXPIRY_DAYS = 2;
const NOW = new Date('2026-10-23T12:00:00.000Z');

function buildTask(opts: { storage: StoragePort; leader?: boolean }) {
  const config = {
    get: vi.fn().mockReturnValue(EXPIRY_DAYS),
  } as unknown as ConfigService<SchedulerEnvConfig, true>;
  const leadership = {
    isLeader: vi.fn().mockReturnValue(opts.leader ?? true),
  } as unknown as SchedulerLeaderService;
  return new LocalStagingExpiryTask(opts.storage, config, leadership);
}

function localStorage(deleteObjectsOlderThan: ReturnType<typeof vi.fn>): LocalStorageAdapter {
  const storage = Object.create(LocalStorageAdapter.prototype) as LocalStorageAdapter;
  Object.assign(storage, { deleteObjectsOlderThan });
  return storage;
}

describe('LocalStagingExpiryTask', () => {
  it('expires staging objects older than the configured window on the leader', async () => {
    const sweep = vi.fn().mockResolvedValue(3);
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });

    try {
      await buildTask({ storage: localStorage(sweep) }).expire();
    } finally {
      vi.useRealTimers();
    }

    expect(sweep).toHaveBeenCalledWith(
      'uploads',
      new Date(NOW.getTime() - EXPIRY_DAYS * 86_400_000),
    );
  });

  it('does nothing on a follower', async () => {
    const sweep = vi.fn();

    await buildTask({ storage: localStorage(sweep), leader: false }).expire();

    expect(sweep).not.toHaveBeenCalled();
  });

  it('does nothing when storage is not the local driver', async () => {
    await expect(buildTask({ storage: {} as StoragePort }).expire()).resolves.toBeUndefined();
  });

  it('logs and survives a failed sweep', async () => {
    const sweep = vi.fn().mockRejectedValue(new Error('disk gone'));
    const task = buildTask({ storage: localStorage(sweep) });

    await expect(task.expire()).resolves.toBeUndefined();
    await expect(task.expire()).resolves.toBeUndefined();
    expect(sweep).toHaveBeenCalledTimes(2);
  });
});
