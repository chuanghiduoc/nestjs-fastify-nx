import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EVENT_PUBLISHER_PORT } from '@nestjs-fastify-nx/core';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { EventBusService } from './event-bus.service';
import { OutboxPublisher } from './outbox-publisher.service';

@Module({
  imports: [
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      maxListeners: 50, // Default 10 triggers MaxListenersExceededWarning in a modular monolith.
      ignoreErrors: false, // Surface listener errors rather than swallowing them.
    }),
  ],
  providers: [
    EventBusService,
    OutboxPublisher,
    {
      // inprocess (default): synchronous EventEmitter2; outbox: persists to Postgres for at-least-once delivery.
      provide: EVENT_PUBLISHER_PORT,
      useFactory: (inProcess: EventBusService, prisma: PrismaService) => {
        const driver = (process.env['EVENT_PUBLISHER_DRIVER'] ?? 'inprocess').toLowerCase();
        return driver === 'outbox' ? new OutboxPublisher(prisma) : inProcess;
      },
      inject: [EventBusService, PrismaService],
    },
  ],
  exports: [EventBusService, OutboxPublisher, EVENT_PUBLISHER_PORT],
})
export class MessagingModule {}
