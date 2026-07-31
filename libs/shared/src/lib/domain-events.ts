import { z } from 'zod';

// Single source of truth for domain event names. These are a published contract, not internal
// identifiers: they are written by Postgres triggers (prisma/migrations), matched by @OnEvent
// subscriptions in another process, and stored in outbox_events rows that outlive any deploy —
// so a rename is a breaking change and must be paired with a migration.
export const DOMAIN_EVENTS = {
  USERS_REGISTERED: 'users.registered',
  USERS_LOGGED_IN: 'users.logged_in',
  USERS_LOGGED_OUT: 'users.logged_out',
} as const;

export type DomainEventType = (typeof DOMAIN_EVENTS)[keyof typeof DOMAIN_EVENTS];

// EventEmitter2 wildcard for subscribers that consume a whole context's stream.
export const DOMAIN_EVENT_STREAMS = {
  USERS: 'users.*',
} as const;

// The payload every users.* event carries. Producers are Postgres triggers, so this is the only
// place the shape is enforced — consumers parse, never cast.
export const userEventPayloadSchema = z.object({
  email: z.email(),
  ip: z.string().optional(),
  userAgent: z.string().optional(),
});

export type UserEventPayload = z.infer<typeof userEventPayloadSchema>;
