export interface OutboxRelayLeadership {
  isLeader(): boolean;
}

export const OUTBOX_RELAY_LEADERSHIP = Symbol('OUTBOX_RELAY_LEADERSHIP');
