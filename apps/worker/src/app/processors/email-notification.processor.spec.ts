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

function makeMockRedis(alreadySent = false): Redis {
  let value: string | null = alreadySent ? '1' : null;
  return {
    get: vi.fn().mockImplementation(async () => value),
    set: vi.fn().mockImplementation(async (_key: string, next: string) => {
      value = next;
      return 'OK';
    }),
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
      messageId:
        '<6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b@nestjs-fastify-nx.local>',
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

  it('does not persist the sent marker when mail.send fails', async () => {
    const sendError = new Error('Timeout');
    vi.mocked(mail.send).mockRejectedValue(sendError);
    const job = makeJob(
      { to: 'err@example.com', subject: 'Err', body: 'Body' },
      { id: '99', attemptsMade: 2 },
    );
    await expect(processor.process(job)).rejects.toThrow();
    // Marker must be cleared so the next BullMQ retry can attempt delivery.
    expect(redis.set).not.toHaveBeenCalled();
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

      await processor.process(job);
      await processor.process(job);

      // mail.send must have been invoked exactly once across both calls.
      expect(mail.send).toHaveBeenCalledTimes(1);
    });

    it('returns early without calling mail.send when slot is already claimed', async () => {
      redis = makeMockRedis(true);
      processor = new EmailNotificationProcessor(mail, redis);

      const job = makeJob(
        { to: 'skip@example.com', subject: 'Skip', body: 'Body' },
        { id: 'job-y' },
      );
      await processor.process(job);

      expect(mail.send).not.toHaveBeenCalled();
    });

    it('sets a post-delivery marker with the expected TTL', async () => {
      const job = makeJob({ to: 'key@example.com', subject: 'K', body: 'B' }, { id: 'job-z' });
      await processor.process(job);

      expect(redis.set).toHaveBeenCalledWith('email:sent:job-z', '1', 'EX', 2_592_000);
    });

    it('does not retry an accepted email solely because marker persistence failed', async () => {
      vi.mocked(redis.set).mockRejectedValueOnce(new Error('redis unavailable'));
      const job = makeJob({ to: 'sent@example.com', subject: 'Sent', body: 'Body' });

      await expect(processor.process(job)).resolves.toBeUndefined();
      expect(mail.send).toHaveBeenCalledOnce();
    });
  });
});
