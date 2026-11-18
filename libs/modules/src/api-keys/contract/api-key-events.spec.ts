import { describe, expect, it } from 'vitest';
import { generateId } from '@nestjs-fastify-nx/shared';
import { apiKeyIssuedPayloadSchema, apiKeyRevokedPayloadSchema } from './index';

const issued = {
  userId: generateId(),
  name: 'CI bot',
  scopes: ['file:read'],
  expiresAt: '2027-01-31T00:00:00.000Z',
};

describe('api key event payload schemas', () => {
  it.each([issued.expiresAt, null])(
    'api_keys.issued accepts the payload its handler publishes (expiresAt %s)',
    (expiresAt) => {
      expect(apiKeyIssuedPayloadSchema.safeParse({ ...issued, expiresAt }).success).toBe(true);
    },
  );

  it.each(['userId', 'name', 'scopes', 'expiresAt'])(
    'api_keys.issued rejects a payload without %s',
    (field) => {
      const { [field as keyof typeof issued]: _omitted, ...rest } = issued;
      expect(apiKeyIssuedPayloadSchema.safeParse(rest).success).toBe(false);
    },
  );

  it('api_keys.revoked requires the acting user', () => {
    expect(apiKeyRevokedPayloadSchema.safeParse({ userId: generateId() }).success).toBe(true);
    expect(apiKeyRevokedPayloadSchema.safeParse({ userId: 'not-a-uuid' }).success).toBe(false);
    expect(apiKeyRevokedPayloadSchema.safeParse({}).success).toBe(false);
  });
});
