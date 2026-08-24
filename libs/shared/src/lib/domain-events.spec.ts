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

  // An event whose name matches no stream is never delivered: listeners subscribe to the wildcard,
  // not to individual names, so a typo'd prefix silently drops the event instead of failing.
  it('routes every event name to exactly one stream wildcard', () => {
    const prefixes = Object.values(DOMAIN_EVENT_STREAMS).map((stream) => stream.replace('*', ''));

    for (const name of Object.values(DOMAIN_EVENTS)) {
      const matches = prefixes.filter((prefix) => name.startsWith(prefix));
      expect(matches, `${name} must match exactly one stream`).toHaveLength(1);
    }
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
