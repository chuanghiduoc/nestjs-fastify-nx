import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE_NAMES } from '@nestjs-fastify-nx/shared';
import { MailAdapter } from '../mail/mail.adapter';

export interface EmailNotificationPayload {
  to: string;
  subject: string;
  body: string;
  templateId?: string;
  variables?: Record<string, string>;
}

@Processor(QUEUE_NAMES.EMAIL_NOTIFICATION, {
  concurrency: 5,
  limiter: { max: 100, duration: 60_000 },
})
export class EmailNotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailNotificationProcessor.name);

  constructor(private readonly mail: MailAdapter) {
    super();
  }

  async process(job: Job<EmailNotificationPayload>): Promise<void> {
    const { to, subject, body } = job.data;
    this.logger.log(
      `Processing email job #${job.id} → to="${to}" subject="${subject}" attempt=${job.attemptsMade + 1}`,
    );
    try {
      await this.mail.send({ to, subject, html: body });
      this.logger.log(`Email job #${job.id} delivered to "${to}"`);
    } catch (err) {
      this.logger.error(
        { err, jobId: job.id, to, attempt: job.attemptsMade + 1 },
        `Email job #${job.id} failed`,
      );
      throw err;
    }
  }
}
