import { Global, Module } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
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
      useFactory: (prisma: PrismaService, emailQueue: Queue) => {
        const mailer: AuthMailDispatcher = {
          send: async ({ to, subject, body, templateId }) => {
            // BullMQ rejects ':' in jobIds — use '__' as separator.
            const jobId = `auth-email__${templateId ?? 'generic'}__${to}__${Date.now()}`;
            await emailQueue.add(
              templateId ?? 'auth-email',
              { to, subject, body, templateId },
              {
                jobId,
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: { count: 100 },
                removeOnFail: { count: 50 },
              },
            );
          },
        };
        return createBetterAuth(prisma.db, mailer);
      },
      inject: [PrismaService, getQueueToken(QUEUE_NAMES.EMAIL_NOTIFICATION)],
    },
    BetterAuthGuard,
    RolesGuard,
  ],
  exports: [BETTER_AUTH_INSTANCE, BetterAuthGuard, RolesGuard],
})
export class BetterAuthModule {}
