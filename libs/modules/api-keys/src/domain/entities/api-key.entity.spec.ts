import { describe, expect, it } from 'vitest';
import { DomainException } from '@nestjs-fastify-nx/core';
import {
  API_KEY_PREFIX,
  PERMISSIONS,
  hashApiKey,
  type Permission,
} from '@nestjs-fastify-nx/shared';
import { ApiKey } from './api-key.entity';

const ORG_ID = '019dd1a5-9235-70db-8d57-54ef90800001';
const USER_ID = '019dd1a5-9235-70db-8d57-54ef90800002';
const ISSUER_GRANT: readonly Permission[] = [
  PERMISSIONS.FILE_READ,
  PERMISSIONS.FILE_CREATE,
  PERMISSIONS.AUDIT_LOG_READ,
];

function issue(overrides: Partial<Parameters<typeof ApiKey.issue>[0]> = {}) {
  return ApiKey.issue({
    organizationId: ORG_ID,
    name: 'CI bot',
    scopes: [PERMISSIONS.FILE_READ],
    createdById: USER_ID,
    grantedToIssuer: ISSUER_GRANT,
    ...overrides,
  });
}

describe('ApiKey', () => {
  it('returns a raw key whose digest is what gets stored', () => {
    const { entity, raw } = issue();

    expect(raw.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(entity.keyHash).toBe(hashApiKey(raw));
    expect(raw).not.toContain(entity.keyHash);
  });

  it('keeps a non-secret prefix that is a strict prefix of the raw key', () => {
    const { entity, raw } = issue();

    expect(raw.startsWith(entity.prefix)).toBe(true);
    expect(entity.prefix.length).toBeLessThan(raw.length);
  });

  it('rejects a scope outside the permission catalog', () => {
    expect(() => issue({ scopes: ['file:teleport'] })).toThrow(DomainException);
  });

  it('rejects an empty scope list', () => {
    expect(() => issue({ scopes: [] })).toThrow(DomainException);
  });

  // The escalation guard: a member must not be able to mint a key stronger than themselves.
  it('rejects a scope the issuer does not hold', () => {
    expect(() => issue({ scopes: [PERMISSIONS.ORGANIZATION_DELETE] })).toThrow(DomainException);
  });

  it('rejects an expiry that is already in the past', () => {
    expect(() => issue({ expiresAt: new Date(Date.now() - 1000) })).toThrow(DomainException);
  });

  it('accepts a future expiry', () => {
    const expiresAt = new Date(Date.now() + 60_000);

    expect(issue({ expiresAt }).entity.expiresAt).toEqual(expiresAt);
  });

  it('deduplicates repeated scopes', () => {
    const { entity } = issue({ scopes: [PERMISSIONS.FILE_READ, PERMISSIONS.FILE_READ] });

    expect(entity.scopes).toEqual([PERMISSIONS.FILE_READ]);
  });

  it('is usable while neither revoked nor expired', () => {
    expect(issue().entity.isUsableAt(new Date())).toBe(true);
  });

  it('is unusable once expired', () => {
    const { entity } = issue({ expiresAt: new Date(Date.now() + 1000) });

    expect(entity.isUsableAt(new Date(Date.now() + 5000))).toBe(false);
  });

  it('is unusable once revoked', () => {
    const { entity } = issue();
    const revoked = ApiKey.reconstitute({
      id: entity.id,
      organizationId: entity.organizationId,
      name: entity.name,
      prefix: entity.prefix,
      keyHash: entity.keyHash,
      scopes: entity.scopes,
      createdById: entity.createdById,
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: new Date(),
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });

    expect(revoked.isUsableAt(new Date())).toBe(false);
  });

  it('trims the name', () => {
    expect(issue({ name: '  CI bot  ' }).entity.name).toBe('CI bot');
  });
});
