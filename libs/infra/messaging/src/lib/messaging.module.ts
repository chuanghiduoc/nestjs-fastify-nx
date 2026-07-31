import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EVENT_PUBLISHER_PORT } from '@nestjs-fastify-nx/core';
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
      // Both come from the container. Constructing OutboxPublisher here instead would make the
      // instance production actually publishes through (outbox is mandatory there) a different one
      // from the DI-managed singleton — so a lifecycle hook or a new dependency added to it later
      // would silently never apply.
      useFactory: (inProcess: EventBusService, outbox: OutboxPublisher) => {
        const driver = (process.env['EVENT_PUBLISHER_DRIVER'] ?? 'inprocess').toLowerCase();
        return driver === 'outbox' ? outbox : inProcess;
      },
      inject: [EventBusService, OutboxPublisher],
    },
  ],
  exports: [EventBusService, OutboxPublisher, EVENT_PUBLISHER_PORT],
})
export class MessagingModule {}
