import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailNotificationProcessor } from './email-notification.processor';
import type { EmailNotificationPayload } from './email-notification.processor';
import type { Job } from 'bullmq';
import type { MailAdapter } from '../mail/mail.adapter';
import type Redis from 'ioredis';

function makeJob(
  data: EmailNotificationPayload,
  overrides: Partial<{ id: string; attemptsMade: number; queueName: string }> = {},
): Job<EmailNotificationPayload> {
  return {
    id: overrides.id ?? '1',
    data,
    attemptsMade: overrides.attemptsMade ?? 0,
    queueName: overrides.queueName ?? 'email-notification',
  } as unknown as Job<EmailNotificationPayload>;
}

function makeMockMailAdapter(): MailAdapter {
  return { send: vi.fn().mockResolvedValue(undefined) } as unknown as MailAdapter;
}

/** Build a Redis mock whose SETNX (set NX EX) returns 'OK' by default (slot unclaimed). */
function makeMockRedis(setnxResult: 'OK' | null = 'OK'): Redis {
  return {
    set: vi.fn().mockResolvedValue(setnxResult),
    del: vi.fn().mockResolvedValue(1),
  } as unknown as Redis;
}

describe('EmailNotificationProcessor', () => {
  let processor: EmailNotificationProcessor;
  let mail: MailAdapter;
  let redis: Redis;

  beforeEach(() => {
    mail = makeMockMailAdapter();
    redis = makeMockRedis();
    processor = new EmailNotificationProcessor(mail, redis);
  });

  it('calls mail.send with correct params for a valid payload', async () => {
    const job = makeJob({ to: 'user@example.com', subject: 'Hello', body: '<p>World</p>' });
    await processor.process(job);
    expect(mail.send).toHaveBeenCalledOnce();
    expect(mail.send).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>World</p>',
    });
  });

  it('resolves without throwing on successful send', async () => {
    const job = makeJob({ to: 'user@example.com', subject: 'Hello', body: 'World' });
    await expect(processor.process(job)).resolves.toBeUndefined();
  });

  it('processes job with optional templateId and variables', async () => {
    const job = makeJob({
      to: 'tpl@example.com',
      subject: 'Welcome',
      body: 'Hi {{name}}',
      templateId: 'tpl-001',
      variables: { name: 'Alice' },
    });
    await processor.process(job);
    expect(mail.send).toHaveBeenCalledOnce();
  });

  it('re-throws when mail.send fails (BullMQ retry)', async () => {
    const sendError = new Error('SMTP connection refused');
    vi.mocked(mail.send).mockRejectedValue(sendError);
    const job = makeJob({ to: 'fail@example.com', subject: 'Fail', body: 'Body' });
    await expect(processor.process(job)).rejects.toThrow('SMTP connection refused');
  });

  it('clears idempotency marker and re-throws when mail.send fails', async () => {
    const sendError = new Error('Timeout');
    vi.mocked(mail.send).mockRejectedValue(sendError);
    const job = makeJob(
      { to: 'err@example.com', subject: 'Err', body: 'Body' },
      { id: '99', attemptsMade: 2 },
    );
    await expect(processor.process(job)).rejects.toThrow();
    // Marker must be cleared so the next BullMQ retry can attempt delivery.
    expect(redis.del).toHaveBeenCalledWith('email:sent:99');
  });

  it('handles retry attempts (attemptsMade > 0) correctly', async () => {
    const job = makeJob(
      { to: 'retry@example.com', subject: 'Retry', body: 'Body' },
      { id: '42', attemptsMade: 2 },
    );
    await processor.process(job);
    expect(mail.send).toHaveBeenCalledOnce();
  });

  describe('idempotency guard', () => {
    it('sends mail exactly once when the same job fires twice', async () => {
      const job = makeJob(
        { to: 'dedup@example.com', subject: 'Hi', body: 'Body' },
        { id: 'job-x' },
      );

      // First fire — slot unclaimed (redis.set returns 'OK').
      await processor.process(job);

      // Second fire — slot already claimed (redis.set returns null).
      vi.mocked(redis.set).mockResolvedValueOnce(null);
      await processor.process(job);

      // mail.send must have been invoked exactly once across both calls.
      expect(mail.send).toHaveBeenCalledTimes(1);
    });

    it('returns early without calling mail.send when slot is already claimed', async () => {
      redis = makeMockRedis(null); // pre-claimed slot
      processor = new EmailNotificationProcessor(mail, redis);

      const job = makeJob(
        { to: 'skip@example.com', subject: 'Skip', body: 'Body' },
        { id: 'job-y' },
      );
      await processor.process(job);

      expect(mail.send).not.toHaveBeenCalled();
    });

    it('sets idempotency key with correct NX + EX args', async () => {
      const job = makeJob({ to: 'key@example.com', subject: 'K', body: 'B' }, { id: 'job-z' });
      await processor.process(job);

      expect(redis.set).toHaveBeenCalledWith('email:sent:job-z', '1', 'EX', 86_400, 'NX');
    });
  });
});
