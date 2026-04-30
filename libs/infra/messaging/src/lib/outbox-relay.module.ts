import { Module } from '@nestjs/common';
import { MessagingModule } from './messaging.module';
import { OutboxRelayService } from './outbox-relay.service';

/**
 * Hosts the outbox relay polling loop. Imported only by the process that
 * should drain the `outbox_events` table — typically the scheduler app.
 *
 * The relay depends on `EventBusService` from `MessagingModule` and on
 * `PrismaService` from the globally-available `DatabaseModule`. It does NOT
 * provide an `EVENT_PUBLISHER_PORT` adapter — that decision is made by
 * `MessagingModule` based on `EVENT_PUBLISHER_DRIVER`.
 */
@Module({
  imports: [MessagingModule],
  providers: [OutboxRelayService],
  exports: [OutboxRelayService],
})
export class OutboxRelayModule {}
