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
      // 50 listeners accommodates a realistic number of handlers in a
      // medium-sized modular monolith without triggering Node.js's
      // MaxListenersExceededWarning (default: 10).  If your feature count
      // grows further, raise this value rather than disabling the warning.
      maxListeners: 50,
      // Propagate unhandled errors thrown inside listeners back to the emitter
      // so they are surfaced rather than silently swallowed.
      ignoreErrors: false,
    }),
  ],
  providers: [
    EventBusService,
    OutboxPublisher,
    {
      // Driver selection is intentionally decided at the wiring layer rather
      // than baked into application code. `inprocess` (default) emits events
      // synchronously through EventEmitter2 — fast, no extra infrastructure,
      // best for development. `outbox` persists events to Postgres in the
      // same connection as the surrounding command and relies on
      // OutboxRelayService (hosted by the scheduler) to deliver them; this
      // gives at-least-once semantics and survives process crashes.
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
