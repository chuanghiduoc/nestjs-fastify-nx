import { Global, Module } from '@nestjs/common';
import { OUTBOX_RELAY_LEADERSHIP } from '@nestjs-fastify-nx/infra-messaging';
import { RedisQueueModule } from '@nestjs-fastify-nx/infra-redis';
import { SchedulerLeaderService } from './scheduler-leader.service';

@Global()
@Module({
  imports: [RedisQueueModule],
  providers: [
    SchedulerLeaderService,
    { provide: OUTBOX_RELAY_LEADERSHIP, useExisting: SchedulerLeaderService },
  ],
  exports: [SchedulerLeaderService, OUTBOX_RELAY_LEADERSHIP],
})
export class SchedulerLeadershipModule {}
