import { z } from 'zod';

// Single source of truth for domain event names. These are a published contract, not internal
// identifiers: they are written by Postgres triggers (prisma/migrations), matched by @OnEvent
// subscriptions in another process, and stored in outbox_events rows that outlive any deploy —
// so a rename is a breaking change and must be paired with a migration.
export const DOMAIN_EVENTS = {
  USERS_REGISTERED: 'users.registered',
  USERS_LOGGED_IN: 'users.logged_in',
  USERS_LOGGED_OUT: 'users.logged_out',
  ORGANIZATIONS_CREATED: 'organizations.created',
  ORGANIZATIONS_DELETED: 'organizations.deleted',
  ORGANIZATIONS_MEMBER_ADDED: 'organizations.member_added',
  ORGANIZATIONS_MEMBER_REMOVED: 'organizations.member_removed',
  ORGANIZATIONS_MEMBER_ROLE_UPDATED: 'organizations.member_role_updated',
  ORGANIZATIONS_ROLE_CHANGED: 'organizations.role_changed',
  FEATURE_FLAGS_CREATED: 'feature_flags.created',
  FEATURE_FLAGS_UPDATED: 'feature_flags.updated',
  FEATURE_FLAGS_DELETED: 'feature_flags.deleted',
  API_KEYS_ISSUED: 'api_keys.issued',
  API_KEYS_REVOKED: 'api_keys.revoked',
} as const;

export type DomainEventType = (typeof DOMAIN_EVENTS)[keyof typeof DOMAIN_EVENTS];

// Produced by OutboxPublisher inside the handler transaction, not by DB triggers: the acting user
// is only known to the application. The trigger-parity spec therefore exempts these names.
export const PUBLISHER_DOMAIN_EVENTS: ReadonlySet<string> = new Set([
  DOMAIN_EVENTS.FEATURE_FLAGS_CREATED,
  DOMAIN_EVENTS.FEATURE_FLAGS_UPDATED,
  DOMAIN_EVENTS.FEATURE_FLAGS_DELETED,
  DOMAIN_EVENTS.API_KEYS_ISSUED,
  DOMAIN_EVENTS.API_KEYS_REVOKED,
]);

// EventEmitter2 wildcard for subscribers that consume a whole context's stream.
export const DOMAIN_EVENT_STREAMS = {
  USERS: 'users.*',
  ORGANIZATIONS: 'organizations.*',
  FEATURE_FLAGS: 'feature_flags.*',
  API_KEYS: 'api_keys.*',
} as const;

// The payload every users.* event carries. Producers are Postgres triggers, so this is the only
// place the shape is enforced — consumers parse, never cast.
export const userEventPayloadSchema = z.object({
  email: z.email(),
  ip: z.string().optional(),
  userAgent: z.string().optional(),
});

export type UserEventPayload = z.infer<typeof userEventPayloadSchema>;

// Written by the organization triggers. `userId`/`role` are absent on organizations.created and
// organizations.deleted, so consumers must treat them as optional rather than assume a membership.
export const organizationEventPayloadSchema = z.object({
  slug: z.string().optional(),
  name: z.string().optional(),
  userId: z.uuid().optional(),
  role: z.string().optional(),
  oldRole: z.string().optional(),
  action: z.enum(['INSERT', 'UPDATE', 'DELETE']).optional(),
});

export type OrganizationEventPayload = z.infer<typeof organizationEventPayloadSchema>;

// Written by the outbox publisher from feature-flag and api-key command handlers. `userId` is the
// acting member; secret material (the raw API key) must never appear here.
export const configurationEventPayloadSchema = z.object({
  userId: z.uuid().optional(),
  key: z.string().optional(),
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  rolloutPercentage: z.number().optional(),
  description: z.string().nullable().optional(),
  scopes: z.array(z.string()).optional(),
  previousEnabled: z.boolean().optional(),
  previousRolloutPercentage: z.number().optional(),
});

export type ConfigurationEventPayload = z.infer<typeof configurationEventPayloadSchema>;
