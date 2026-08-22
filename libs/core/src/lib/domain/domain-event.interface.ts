export interface DomainEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateId: string;
  readonly occurredAt: Date;
  readonly payload: Record<string, unknown>;
  /**
   * Tenant the event belongs to, carried on the outbox row rather than in the payload so a
   * listener in another process can rebuild the request's tenant context. Null for events that
   * predate an organization (a user registering) or outlive one (an organization being deleted).
   */
  readonly organizationId?: string | null;
}
