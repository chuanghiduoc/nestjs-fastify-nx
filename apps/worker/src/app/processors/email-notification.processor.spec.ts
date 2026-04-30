import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailNotificationProcessor } from './email-notification.processor';
import type { EmailNotificationPayload } from './email-notification.processor';
import type { Job } from 'bullmq';
import type { MailAdapter } from '../mail/mail.adapter';

function makeJob(
  data: EmailNotificationPayload,
  overrides: Partial<{ id: string; attemptsMade: number }> = {},
): Job<EmailNotificationPayload> {
  return {
    id: overrides.id ?? '1',
    data,
    attemptsMade: overrides.attemptsMade ?? 0,
  } as unknown as Job<EmailNotificationPayload>;
}

function makeMockMailAdapter(): MailAdapter {
  return { send: vi.fn().mockResolvedValue(undefined) } as unknown as MailAdapter;
}

describe('EmailNotificationProcessor', () => {
  let processor: EmailNotificationProcessor;
  let mail: MailAdapter;

  beforeEach(() => {
    mail = makeMockMailAdapter();
    processor = new EmailNotificationProcessor(mail);
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

  it('logs error context when send fails', async () => {
    const sendError = new Error('Timeout');
    vi.mocked(mail.send).mockRejectedValue(sendError);
    const job = makeJob(
      { to: 'err@example.com', subject: 'Err', body: 'Body' },
      { id: '99', attemptsMade: 2 },
    );
    await expect(processor.process(job)).rejects.toThrow();
  });

  it('handles retry attempts (attemptsMade > 0) correctly', async () => {
    const job = makeJob(
      { to: 'retry@example.com', subject: 'Retry', body: 'Body' },
      { id: '42', attemptsMade: 2 },
    );
    await processor.process(job);
    expect(mail.send).toHaveBeenCalledOnce();
  });
});
