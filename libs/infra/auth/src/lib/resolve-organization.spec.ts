import { describe, expect, it } from 'vitest';
import { DomainException } from '@nestjs-fastify-nx/core';
import { PERMISSIONS } from '@nestjs-fastify-nx/shared';
import { resolveOrganizationId } from './resolve-organization';
import type { AuthenticatedApiKey } from './api-key.types';
import type { AuthenticatedSession } from './better-auth.types';

const ORG_ID = '019dd1a5-9235-70db-8d57-54ef92300001';
const MACHINE_ORGANIZATION = '019dd1a5-9235-70db-8d57-54ef92300002';
const MACHINE_PRINCIPAL = '019dd1a5-9235-70db-8d57-54ef92300004';

const SESSION: AuthenticatedSession = {
  userId: '019dd1a5-9235-70db-8d57-54ef92300003',
  email: 'member@example.com',
  name: 'Member',
  role: 'USER',
  status: 'ACTIVE',
  sessionId: 's-1',
  sessionToken: 't-1',
  organizationId: ORG_ID,
};

const MACHINE: AuthenticatedApiKey = {
  apiKeyId: MACHINE_PRINCIPAL,
  organizationId: MACHINE_ORGANIZATION,
  scopes: [PERMISSIONS.FEATURE_FLAG_READ],
};

describe('resolveOrganizationId', () => {
  it('uses the active organization of a session caller', () => {
    expect(resolveOrganizationId(SESSION, undefined)).toBe(ORG_ID);
  });

  it('uses the organization the key was issued for', () => {
    expect(resolveOrganizationId(undefined, MACHINE)).toBe(MACHINE_ORGANIZATION);
  });

  // A key carries its own tenant and there is no session to read an active organization from, so
  // the key must win rather than fall through to a session that may be scoped elsewhere.
  it('prefers the key when both are somehow present', () => {
    expect(resolveOrganizationId(SESSION, MACHINE)).toBe(MACHINE_ORGANIZATION);
  });

  it('refuses a session with no active organization', () => {
    expect(() =>
      resolveOrganizationId({ ...SESSION, organizationId: undefined }, undefined),
    ).toThrow(DomainException);
  });

  it('refuses when neither identity is present', () => {
    try {
      resolveOrganizationId(undefined, undefined);
      expect.unreachable('expected a forbidden domain exception');
    } catch (err) {
      expect(err).toBeInstanceOf(DomainException);
      expect((err as DomainException).kind).toBe('forbidden');
    }
  });
});
