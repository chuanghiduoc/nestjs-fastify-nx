import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type Redis from 'ioredis';
import { createHash } from 'node:crypto';
import { QUEUE_NAMES, positiveIntEnv } from '@nestjs-fastify-nx/shared';
import { REDIS_QUEUE_CLIENT } from '@nestjs-fastify-nx/infra-redis';
import { MailAdapter } from '../mail/mail.adapter';

export interface EmailNotificationPayload {
  to: string;
  subject: string;
  body: string;
  templateId?: string;
  variables?: Record<string, string>;
}

const EMAIL_CONCURRENCY = positiveIntEnv('WORKER_EMAIL_CONCURRENCY', 5);
// Thirty days covers outbox retention and ordinary manual-replay windows while staying bounded.
const IDEMPOTENCY_TTL_SECONDS = 30 * 24 * 60 * 60;

// Mask local-part: logs stay grep-able by domain without exposing full addresses.
function redactEmail(addr: string): string {
  const at = addr.lastIndexOf('@');
  if (at <= 0) return '***';
  const domain = addr.slice(at);
  const local = addr.slice(0, at);
  return local.length <= 1 ? `***${domain}` : `${local[0]}***${domain}`;
}

@Processor(QUEUE_NAMES.EMAIL_NOTIFICATION, {
  concurrency: EMAIL_CONCURRENCY,
  limiter: { max: 100, duration: 60_000 },
})
export class EmailNotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailNotificationProcessor.name);

  constructor(
    private readonly mail: MailAdapter,
    @Inject(REDIS_QUEUE_CLIENT) private readonly redis: Redis,
  ) {
    super();
  }

  async process(job: Job<EmailNotificationPayload>): Promise<void> {
    if (job.id === undefined) {
      throw new Error('Email job has no id; deterministic delivery identity cannot be established');
    }
    const jobId = String(job.id);
    const { to, subject, body } = job.data;
    const toMasked = redactEmail(to);
    this.logger.log(
      `Processing email job #${job.id} → to="${toMasked}" subject="${subject}" attempt=${job.attemptsMade + 1}`,
    );

    // Mark only after SMTP accepts the message. Claiming first can permanently lose an email when
    // a worker crashes between SETNX and send; BullMQ already serializes a single job execution.
    const key = `email:sent:${jobId}`;
    if ((await this.redis.get(key)) === '1') {
      this.logger.warn(`email job #${job.id} already sent; skipping duplicate fire`);
      return;
    }

    try {
      const messageId = `<${createHash('sha256').update(jobId).digest('hex')}@nestjs-fastify-nx.local>`;
      await this.mail.send({ to, subject, html: body, messageId });
      await this.redis
        .set(key, '1', 'EX', IDEMPOTENCY_TTL_SECONDS)
        .catch((markerError: unknown) => {
          this.logger.error(
            { jobId: job.id, recipient: toMasked, cause: markerError },
            'Email delivered but sent-marker persistence failed',
          );
        });
      this.logger.log(`Email job #${job.id} delivered to "${toMasked}"`);
    } catch (err) {
      this.logger.error(
        { err, jobId: job.id, to: toMasked, attempt: job.attemptsMade + 1 },
        `Email job #${job.id} failed`,
      );
      throw err;
    }
  }
}
