import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { enqueueUploadVerification } from '@nestjs-fastify-nx/modules-upload';
import type { SchedulerLeaderService } from '../leadership/scheduler-leader.service';
import { UploadVerificationRecoveryTask } from './upload-verification-recovery.task';

vi.mock('@nestjs-fastify-nx/modules-upload', () => ({
  enqueueUploadVerification: vi.fn().mockResolvedValue(undefined),
}));

const candidate = {
  id: '019dd1a7-443a-7dd2-a546-2169d81d796a',
  key: 'files/user/file.png',
  bucket: 'uploads',
  contentType: 'image/png',
  updatedAt: new Date('2026-09-01T00:00:00Z'),
};

function setup() {
  const query = vi.fn().mockResolvedValue([candidate]);
  const isLeader = vi.fn().mockReturnValue(true);
  const queue = {} as Queue;
  const task = new UploadVerificationRecoveryTask(
    { db: { $queryRaw: query } } as unknown as PrismaService,
    queue,
    { isLeader } as unknown as SchedulerLeaderService,
  );
  return { task, query, isLeader, queue };
}

afterEach(() => vi.clearAllMocks());

describe('UploadVerificationRecoveryTask', () => {
  it('redrives persisted verification work without a frontend request', async () => {
    const { task, queue, query } = setup();
    await task.recover();
    expect(enqueueUploadVerification).toHaveBeenCalledWith(queue, {
      key: candidate.key,
      bucket: candidate.bucket,
      declaredContentType: 'image/png',
    });
    const sql = query.mock.calls[0][0].join('');
    expect(sql).toContain('status = \'VERIFYING\' AND "deletedAt" IS NULL');
    expect(sql).toContain('ORDER BY "updatedAt", id');
    expect(query.mock.calls[0].at(-1)).toBe(100);
  });

  it('skips followers and stops dispatching when leadership is lost', async () => {
    const { task, isLeader, query } = setup();
    isLeader.mockReturnValueOnce(false);
    await task.recover();
    expect(query).not.toHaveBeenCalled();
    isLeader.mockReturnValueOnce(true).mockReturnValueOnce(false);
    await task.recover();
    expect(enqueueUploadVerification).not.toHaveBeenCalled();
  });

  it('prevents overlapping scans and releases its guard after database failures', async () => {
    const { task, query } = setup();
    let rejectQuery: (reason: Error) => void = () => undefined;
    query.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectQuery = reject;
      }),
    );
    const first = task.recover();
    await task.recover();
    expect(query).toHaveBeenCalledTimes(1);
    rejectQuery(new Error('database unavailable'));
    await first;
    await task.recover();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('retains failed candidates for a later tick after a queue outage', async () => {
    const { task, query } = setup();
    vi.mocked(enqueueUploadVerification).mockRejectedValueOnce(new Error('redis unavailable'));
    await task.recover();
    await task.recover();
    expect(enqueueUploadVerification).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1].slice(1)).toEqual(
      query.mock.calls[0].slice(1).map((value, index) => (index < 2 ? expect.any(Date) : value)),
    );
  });

  it('advances beyond a full batch of active jobs then restarts its scan', async () => {
    const { task, query } = setup();
    query.mockResolvedValueOnce(Array.from({ length: 100 }, () => candidate));
    query.mockResolvedValueOnce([]);
    await task.recover();
    await task.recover();
    expect(query.mock.calls[1]).toContain(candidate.id);
    expect(query.mock.calls[1]).toContain(candidate.updatedAt);
    await task.recover();
    expect(query.mock.calls[2]).toContain('00000000-0000-0000-0000-000000000000');
  });
});
