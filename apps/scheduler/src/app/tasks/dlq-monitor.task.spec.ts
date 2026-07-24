import { describe, it, expect, vi, type Mock } from 'vitest';
import type * as InfraRedis from '@nestjs-fastify-nx/infra-redis';

interface QueueMock {
  name: string;
  getJobCounts: Mock;
  getFailed: Mock;
  getJob: Mock;
  close: Mock;
  disconnect: Mock;
}

const { routeSpy, queues } = vi.hoisted(() => ({
  routeSpy: vi.fn(),
  queues: new Map<string, QueueMock>(),
}));

vi.mock('@nestjs-fastify-nx/infra-redis', async (importOriginal) => {
  const actual = await importOriginal<typeof InfraRedis>();
  return { ...actual, routeFailedJobToDlq: (...args: unknown[]) => routeSpy(...args) };
});

vi.mock('bullmq', () => ({
  // Regular function (not an arrow) so `new Queue(name)` is a valid constructor call; returning an
  // object makes `new` yield the mock.
  Queue: vi.fn().mockImplementation(function (name: string): QueueMock {
    const created: QueueMock = {
      name,
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, failed: 0 }),
      getFailed: vi.fn().mockResolvedValue([]),
      getJob: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    queues.set(name, created);
    return created;
  }),
}));

function q(name: string): QueueMock {
  const found = queues.get(name);
  if (!found) throw new Error(`mock queue "${name}" was not created`);
  return found;
}

import { DlqMonitorTask } from './dlq-monitor.task';
import type { SchedulerLeaderService } from '../leadership/scheduler-leader.service';

function build(leader = true) {
  routeSpy.mockClear();
  queues.clear();
  const config = {
    get: vi.fn().mockReturnValue('x'),
  } as unknown as ConstructorParameters<typeof DlqMonitorTask>[0];
  const leadership = {
    isLeader: vi.fn().mockReturnValue(leader),
  } as unknown as SchedulerLeaderService;
  const task = new DlqMonitorTask(config, leadership);
  return { task };
}

describe('DlqMonitorTask.reconcile', () => {
  it('routes a terminal-failed job that is not yet in the DLQ', async () => {
    const { task } = build();
    const src = q('email-notification');
    const dlq = q('email-notification.dlq');
    src.getFailed.mockResolvedValue([
      { id: 'j1', failedReason: 'boom', attemptsMade: 3, opts: { attempts: 3 } },
    ]);
    dlq.getJob.mockResolvedValue(undefined);

    await task.reconcile();

    expect(dlq.getJob).toHaveBeenCalledWith('dlq__j1');
    expect(routeSpy).toHaveBeenCalledWith(
      src,
      dlq,
      expect.objectContaining({ jobId: 'j1' }),
      expect.anything(),
    );
  });

  it('skips a job already present in the DLQ (idempotent, no re-route/log-spam)', async () => {
    const { task } = build();
    const src = q('email-notification');
    const dlq = q('email-notification.dlq');
    src.getFailed.mockResolvedValue([{ id: 'j1', failedReason: 'boom' }]);
    dlq.getJob.mockResolvedValue({ id: 'dlq__j1' });

    await task.reconcile();

    expect(routeSpy).not.toHaveBeenCalled();
  });

  it('does nothing on a follower replica', async () => {
    const { task } = build(false);

    await task.reconcile();

    expect(routeSpy).not.toHaveBeenCalled();
  });

  it('continues to the next queue when one source scan throws', async () => {
    const { task } = build();
    q('email-notification').getFailed.mockRejectedValue(new Error('redis down'));
    const upload = q('upload-verification');
    upload.getFailed.mockResolvedValue([{ id: 'u1', failedReason: 'x' }]);
    upload.getJob.mockResolvedValue(undefined);

    await expect(task.reconcile()).resolves.toBeUndefined();

    expect(routeSpy).toHaveBeenCalledWith(
      upload,
      q('upload-verification.dlq'),
      expect.objectContaining({ jobId: 'u1' }),
      expect.anything(),
    );
  });
});
