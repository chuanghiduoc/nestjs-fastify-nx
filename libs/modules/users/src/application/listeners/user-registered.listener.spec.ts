import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EventEmitter2 } from 'eventemitter2';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { QUEUE_NAMES } from '@nestjs-fastify-nx/shared';
import { UserRegisteredListener } from './user-registered.listener';
import { UserRegistered } from '../../domain/events/user-registered.event';

function makeMockQueue(): Queue {
  return { add: vi.fn().mockResolvedValue({ id: 'job-1' }) } as unknown as Queue;
}

describe('UserRegisteredListener', () => {
  let listener: UserRegisteredListener;
  let emailQueue: Queue;

  beforeEach(() => {
    emailQueue = makeMockQueue();
    listener = new UserRegisteredListener(emailQueue);
  });

  it('calls queue.add when a UserRegistered event is handled', async () => {
    const event = new UserRegistered('user-123', { email: 'alice@example.com' });
    await listener.handle(event);
    expect(emailQueue.add).toHaveBeenCalledOnce();
  });

  it('enqueues a job with the user email as "to"', async () => {
    const event = new UserRegistered('user-456', { email: 'bob@example.com' });
    await listener.handle(event);
    const [, jobData] = vi.mocked(emailQueue.add).mock.calls[0];
    expect(jobData).toMatchObject({ to: 'bob@example.com' });
  });

  it('enqueues a job with truthy subject and body', async () => {
    const event = new UserRegistered('user-789', { email: 'carol@example.com' });
    await listener.handle(event);
    const [, jobData] = vi.mocked(emailQueue.add).mock.calls[0];
    expect(jobData).toMatchObject({
      subject: expect.stringMatching(/.+/),
      body: expect.stringMatching(/.+/),
    });
  });

  it('uses "welcome-email" as the job name', async () => {
    const event = new UserRegistered('user-000', { email: 'dave@example.com' });
    await listener.handle(event);
    const [jobName] = vi.mocked(emailQueue.add).mock.calls[0];
    expect(jobName).toBe('welcome-email');
  });

  it('resolves without throwing on success', async () => {
    const event = new UserRegistered('user-001', { email: 'eve@example.com' });
    await expect(listener.handle(event)).resolves.toBeUndefined();
  });

  it('propagates an async queue failure through emitAsync', async () => {
    vi.mocked(emailQueue.add).mockRejectedValueOnce(new Error('queue unavailable'));
    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        UserRegisteredListener,
        { provide: getQueueToken(QUEUE_NAMES.EMAIL_NOTIFICATION), useValue: emailQueue },
      ],
    }).compile();
    await moduleRef.init();

    try {
      const emitter = moduleRef.get(EventEmitter2);
      const event = new UserRegistered('user-failed', { email: 'failed@example.com' });
      await expect(emitter.emitAsync('users.registered', event)).rejects.toThrow(
        'queue unavailable',
      );
    } finally {
      await moduleRef.close();
    }
  });
});
