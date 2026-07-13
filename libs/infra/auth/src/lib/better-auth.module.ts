import { createHash } from 'node:crypto';
import { Global, Module } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { I18nService } from 'nestjs-i18n';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { QUEUE_NAMES } from '@nestjs-fastify-nx/shared';
import { createBetterAuth, type AuthMailDispatcher } from './better-auth.config';
import { BETTER_AUTH_INSTANCE } from './better-auth-instance.token';
import { BetterAuthGuard } from './better-auth.guard';
import { RolesGuard } from './roles.guard';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.EMAIL_NOTIFICATION })],
  providers: [
    {
      provide: BETTER_AUTH_INSTANCE,
      useFactory: (prisma: PrismaService, emailQueue: Queue, i18n: I18nService) => {
        const mailer: AuthMailDispatcher = {
          send: async ({ to, subject, body, templateId }) => {
            // Content fingerprint keeps the jobId idempotent: a retried callback
            // with the identical email dedupes, while a fresh token (new body)
            // produces a new id and still sends. BullMQ rejects ':' in jobIds.
            const label = (templateId ?? 'generic').replace(/[^a-zA-Z0-9_-]/g, '-');
            const fingerprint = createHash('sha256')
              .update(`${templateId ?? 'generic'}|${to}|${subject}|${body}`)
              .digest('hex')
              .slice(0, 32);
            const jobId = `auth-email__${label}__${fingerprint}`;
            await emailQueue.add(
              templateId ?? 'auth-email',
              { to, subject, body, templateId },
              {
                jobId,
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: { age: 30 * 24 * 60 * 60, count: 10_000 },
                removeOnFail: { age: 30 * 24 * 60 * 60, count: 1_000 },
              },
            );
          },
        };
        return createBetterAuth(prisma.db, mailer, i18n);
      },
      inject: [PrismaService, getQueueToken(QUEUE_NAMES.EMAIL_NOTIFICATION), I18nService],
    },
    BetterAuthGuard,
    RolesGuard,
  ],
  exports: [BETTER_AUTH_INSTANCE, BetterAuthGuard, RolesGuard],
})
export class BetterAuthModule {}
