import { createHash } from 'node:crypto';
import { Global, Module } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { I18nService } from 'nestjs-i18n';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import {
  BULL_JOB_NAMES,
  GENERIC_EMAIL_TEMPLATE,
  QUEUE_NAMES,
  RETRIED_JOB_OPTIONS,
} from '@nestjs-fastify-nx/shared';
import { createBetterAuth, type AuthMailDispatcher } from './better-auth.config';
import { BETTER_AUTH_INSTANCE } from './better-auth-instance.token';
import { BetterAuthGuard } from './better-auth.guard';
import { ApiKeyGuard } from './api-key.guard';
import { RolesGuard } from './roles.guard';

const JOB_ID_FINGERPRINT_LENGTH = 32;

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
            const template = templateId ?? GENERIC_EMAIL_TEMPLATE;
            const label = template.replace(/[^a-zA-Z0-9_-]/g, '-');
            const fingerprint = createHash('sha256')
              .update(`${template}|${to}|${subject}|${body}`)
              .digest('hex')
              .slice(0, JOB_ID_FINGERPRINT_LENGTH);
            const jobId = `${BULL_JOB_NAMES.AUTH_EMAIL}__${label}__${fingerprint}`;
            await emailQueue.add(
              templateId ?? BULL_JOB_NAMES.AUTH_EMAIL,
              { to, subject, body, templateId },
              {
                jobId,
                ...RETRIED_JOB_OPTIONS,
              },
            );
          },
        };
        return createBetterAuth(prisma.db, mailer, i18n);
      },
      inject: [PrismaService, getQueueToken(QUEUE_NAMES.EMAIL_NOTIFICATION), I18nService],
    },
    BetterAuthGuard,
    ApiKeyGuard,
    RolesGuard,
  ],
  exports: [BETTER_AUTH_INSTANCE, BetterAuthGuard, ApiKeyGuard, RolesGuard],
})
export class BetterAuthModule {}
