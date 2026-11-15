import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EventEmitter2 } from 'eventemitter2';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import type { DomainEvent } from '@nestjs-fastify-nx/core';
import { DOMAIN_EVENTS, QUEUE_NAMES, generateId } from '@nestjs-fastify-nx/shared';
import { UserRegisteredListener } from './user-registered.listener';

function makeMockQueue(): Queue {
  return { add: vi.fn().mockResolvedValue({ id: 'job-1' }) } as unknown as Queue;
}

function makeEvent(aggregateId: string, email: string): DomainEvent {
  return {
    eventId: generateId(),
    eventType: DOMAIN_EVENTS.USERS_REGISTERED,
    aggregateId,
    occurredAt: new Date(),
    payload: { email },
  };
}

describe('UserRegisteredListener', () => {
  let listener: UserRegisteredListener;
  let emailQueue: Queue;

  beforeEach(() => {
    emailQueue = makeMockQueue();
    listener = new UserRegisteredListener(emailQueue);
  });

  it('calls queue.add when a users.registered event is handled', async () => {
    const event = makeEvent('user-123', 'alice@example.com');
    await listener.handle(event);
    expect(emailQueue.add).toHaveBeenCalledOnce();
  });

  it('enqueues a job with the user email as "to"', async () => {
    const event = makeEvent('user-456', 'bob@example.com');
    await listener.handle(event);
    const [, jobData] = vi.mocked(emailQueue.add).mock.calls[0];
    expect(jobData).toMatchObject({ to: 'bob@example.com' });
  });

  it('enqueues a job with truthy subject and body', async () => {
    const event = makeEvent('user-789', 'carol@example.com');
    await listener.handle(event);
    const [, jobData] = vi.mocked(emailQueue.add).mock.calls[0];
    expect(jobData).toMatchObject({
      subject: expect.stringMatching(/.+/),
      body: expect.stringMatching(/.+/),
    });
  });

  it('uses "welcome-email" as the job name', async () => {
    const event = makeEvent('user-000', 'dave@example.com');
    await listener.handle(event);
    const [jobName] = vi.mocked(emailQueue.add).mock.calls[0];
    expect(jobName).toBe('welcome-email');
  });

  it('resolves without throwing on success', async () => {
    const event = makeEvent('user-001', 'eve@example.com');
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
      const event = makeEvent('user-failed', 'failed@example.com');
      await expect(emitter.emitAsync('users.registered', event)).rejects.toThrow(
        'queue unavailable',
      );
    } finally {
      await moduleRef.close();
    }
  });
});
