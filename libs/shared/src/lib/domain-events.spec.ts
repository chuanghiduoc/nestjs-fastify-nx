import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { DOMAIN_EVENTS, DOMAIN_EVENT_STREAMS, userEventPayloadSchema } from './domain-events';

// The producers for these events are Postgres triggers, so TypeScript cannot see the contract at
// all: renaming a constant here compiles and passes every other test while the relay keeps
// receiving the old name from the database and no listener matches it.
function migrationSql(): string {
  const dir = join(__dirname, '../../../../prisma/migrations');
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(join(dir, entry.name, 'migration.sql'), 'utf8'))
    .join('\n');
}

describe('DOMAIN_EVENTS', () => {
  const sql = migrationSql();

  it.each(Object.entries(DOMAIN_EVENTS))(
    '%s is the name emitted by the trigger SQL',
    (_key, name) => {
      expect(sql).toContain(`'${name}'`);
    },
  );

  it('matches every event name with its stream wildcard', () => {
    const prefix = DOMAIN_EVENT_STREAMS.USERS.replace('*', '');
    const userEvents = Object.values(DOMAIN_EVENTS).filter((name) => name.startsWith(prefix));
    expect(userEvents).toHaveLength(Object.keys(DOMAIN_EVENTS).length);
  });
});

describe('userEventPayloadSchema', () => {
  it('accepts the payload shape the trigger builds', () => {
    expect(userEventPayloadSchema.safeParse({ email: 'user@example.com' }).success).toBe(true);
    expect(
      userEventPayloadSchema.safeParse({ email: 'user@example.com', ip: '1.2.3.4', userAgent: 'x' })
        .success,
    ).toBe(true);
  });

  it('rejects a payload that would enqueue an undeliverable email', () => {
    expect(userEventPayloadSchema.safeParse({}).success).toBe(false);
    expect(userEventPayloadSchema.safeParse({ email: '' }).success).toBe(false);
    expect(userEventPayloadSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });
});
