import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type Redis from 'ioredis';
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

// Resolved once at module load — process.env is fully populated by the time
// NestJS evaluates class decorators.
const EMAIL_CONCURRENCY = positiveIntEnv('WORKER_EMAIL_CONCURRENCY', 5);

// Idempotency key TTL: 24 h covers the full BullMQ stalled-recovery window
// (3 attempts × exponential backoff). After the TTL the key self-expires
// so long-dormant jobs are not permanently blocked.
const IDEMPOTENCY_TTL_SECONDS = 86_400;

// Mask the local-part so logs stay grep-able by domain (useful when narrowing
// down a customer tenant) without leaking the full address into log aggregators.
// "alice@example.com" → "a***@example.com", "@x" → "***@x" for very short locals.
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
    const { to, subject, body } = job.data;
    const toMasked = redactEmail(to);
    this.logger.log(
      `Processing email job #${job.id} → to="${toMasked}" subject="${subject}" attempt=${job.attemptsMade + 1}`,
    );

    // SETNX guard: claim the idempotency slot before touching SMTP.
    // BullMQ retries reuse the same job.id, so a stalled-recovery re-fire
    // on the same job hits a claimed slot and returns early — exactly one
    // email per job regardless of how many times the worker fires it.
    const key = `email:sent:${job.id}`;
    const claimed = await this.redis.set(key, '1', 'EX', IDEMPOTENCY_TTL_SECONDS, 'NX');
    if (claimed !== 'OK') {
      this.logger.warn(`email job #${job.id} already sent; skipping duplicate fire`);
      return;
    }

    try {
      await this.mail.send({ to, subject, html: body });
      this.logger.log(`Email job #${job.id} delivered to "${toMasked}"`);
    } catch (err) {
      // Clear the marker so the next retry can attempt delivery.
      // Only the SMTP-success path is idempotency-protected; a failed
      // attempt should still retry rather than being silently swallowed.
      // If this del fails (Redis flap), the marker stays alive for up to 24 h
      // and all subsequent retries will be skipped — the email is permanently
      // lost within that window. Logged at error so on-call paging / Sentry
      // triggers; a warn would mask a data-loss event.
      await this.redis.del(key).catch((delErr) => {
        this.logger.error(
          { jobId: job.id, recipient: toMasked, cause: delErr },
          `SETNX marker cleanup failed after SMTP error — email may be permanently skipped within 24h TTL window. JobId=${job.id}, recipient=${toMasked}`,
        );
      });
      this.logger.error(
        { err, jobId: job.id, to: toMasked, attempt: job.attemptsMade + 1 },
        `Email job #${job.id} failed`,
      );
      throw err;
    }
  }
}
