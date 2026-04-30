import type { DomainEvent } from './domain-event.interface';

export abstract class AggregateRoot {
  private _domainEvents: DomainEvent[] = [];

  addDomainEvent(event: DomainEvent): void {
    this._domainEvents.push(event);
  }

  pullDomainEvents(): DomainEvent[] {
    const events = [...this._domainEvents];
    this._domainEvents = [];
    return events;
  }

  hasDomainEvents(): boolean {
    return this._domainEvents.length > 0;
  }
}
