import { describe, expect, it } from 'vitest';
import { generateId } from '@nestjs-fastify-nx/shared';
import {
  userLoggedInPayloadSchema,
  userLoggedOutPayloadSchema,
  userRegisteredPayloadSchema,
} from './index';

describe('users.registered payload schema', () => {
  it('accepts the payload shape the trigger builds', () => {
    expect(userRegisteredPayloadSchema.safeParse({ email: 'user@example.com' }).success).toBe(true);
  });

  it('rejects a payload that would enqueue an undeliverable email', () => {
    expect(userRegisteredPayloadSchema.safeParse({}).success).toBe(false);
    expect(userRegisteredPayloadSchema.safeParse({ email: '' }).success).toBe(false);
    expect(userRegisteredPayloadSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });
});

describe('users.logged_in payload schema', () => {
  it('accepts a session id with or without the stripped origin fields', () => {
    const sessionId = generateId();
    expect(userLoggedInPayloadSchema.safeParse({ sessionId }).success).toBe(true);
    expect(
      userLoggedInPayloadSchema.safeParse({ sessionId, ip: '203.0.113.5', userAgent: 'curl/8' })
        .success,
    ).toBe(true);
  });

  it('rejects a payload without the session id', () => {
    expect(userLoggedInPayloadSchema.safeParse({ ip: '203.0.113.5' }).success).toBe(false);
  });
});

describe('users.logged_out payload schema', () => {
  const sessionExpiresAt = '2026-12-01T10:00:00.000Z';

  it('accepts the token id and the expiry of the ended session', () => {
    expect(
      userLoggedOutPayloadSchema.safeParse({ tokenId: generateId(), sessionExpiresAt }).success,
    ).toBe(true);
  });

  it('rejects a payload without the token id or the session expiry', () => {
    expect(userLoggedOutPayloadSchema.safeParse({ sessionExpiresAt }).success).toBe(false);
    expect(userLoggedOutPayloadSchema.safeParse({ tokenId: generateId() }).success).toBe(false);
  });
});
