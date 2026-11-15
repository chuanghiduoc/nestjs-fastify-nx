import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainException } from '@nestjs-fastify-nx/core';
import type { DomainEvent, EventPublisherPort } from '@nestjs-fastify-nx/core';
import { ERROR_CODES } from '@nestjs-fastify-nx/contracts';

@Injectable()
export class EventBusService implements EventPublisherPort {
  constructor(private readonly emitter: EventEmitter2) {}

  async publish(event: DomainEvent): Promise<void> {
    const results = await this.emitter.emitAsync(event.eventType, event);
    if (results.length === 0) {
      throw new DomainException({
        kind: 'malformed',
        code: ERROR_CODES.BUSINESS_RULE_VIOLATION,
        title: `No listener registered for domain event "${event.eventType}"`,
        permanent: true,
        violations: [
          {
            path: 'eventType',
            code: ERROR_CODES.BUSINESS_RULE_VIOLATION,
            message: `No listener registered for domain event "${event.eventType}"`,
          },
        ],
      });
    }
  }

  async publishAll(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }
}
