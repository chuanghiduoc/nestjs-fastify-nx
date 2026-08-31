import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorizationPort } from '@nestjs-fastify-nx/core';
import { PERMISSIONS, generateId, type Permission } from '@nestjs-fastify-nx/shared';
import { ApiKey } from '../domain/entities/api-key.entity';
import { InMemoryApiKeyRepository } from '../testing/in-memory-api-key-repository';
import { CreateApiKeyHandler } from './commands/create-api-key/create-api-key.handler';
import { CreateApiKeyCommand } from './commands/create-api-key/create-api-key.command';
import { RevokeApiKeyHandler } from './commands/revoke-api-key/revoke-api-key.handler';
import { RevokeApiKeyCommand } from './commands/revoke-api-key/revoke-api-key.command';
import { ListApiKeysHandler } from './queries/list-api-keys/list-api-keys.handler';
import { ListApiKeysQuery } from './queries/list-api-keys/list-api-keys.query';

const ORG_ID = '019dd1a5-9235-70db-8d57-54ef90900001';
const OTHER_ORG_ID = '019dd1a5-9235-70db-8d57-54ef90900002';
const USER_ID = '019dd1a5-9235-70db-8d57-54ef90900003';

function authorizationHolding(permissions: readonly Permission[]): AuthorizationPort {
  return {
    permissionsFor: vi.fn().mockResolvedValue(permissions),
  } as unknown as AuthorizationPort;
}

function seedKey(repository: InMemoryApiKeyRepository, organizationId = ORG_ID): ApiKey {
  const { entity } = ApiKey.issue({
    organizationId,
    name: 'seeded',
    scopes: [PERMISSIONS.FILE_READ],
    createdById: USER_ID,
    grantedToIssuer: [PERMISSIONS.FILE_READ],
  });
  repository.seed(entity);
  return entity;
}

describe('CreateApiKeyHandler', () => {
  let repository: InMemoryApiKeyRepository;

  beforeEach(() => {
    repository = new InMemoryApiKeyRepository();
  });

  it('returns the raw key exactly once and persists only its digest', async () => {
    const handler = new CreateApiKeyHandler(
      repository,
      authorizationHolding([PERMISSIONS.FILE_READ]),
    );

    const issued = await handler.execute(
      new CreateApiKeyCommand({
        organizationId: ORG_ID,
        userId: USER_ID,
        name: 'CI bot',
        scopes: [PERMISSIONS.FILE_READ],
      }),
    );

    expect(issued.key).toBeTruthy();
    const listed = await repository.findAllCursor({
      organizationId: ORG_ID,
      limit: 10,
      includeRevoked: false,
    });
    expect(listed.items).toHaveLength(1);
    expect(JSON.stringify(issued)).not.toContain(listed.items[0].keyHash);
  });

  it('refuses a scope the caller does not hold', async () => {
    const handler = new CreateApiKeyHandler(
      repository,
      authorizationHolding([PERMISSIONS.FILE_READ]),
    );

    const execute = handler.execute(
      new CreateApiKeyCommand({
        organizationId: ORG_ID,
        userId: USER_ID,
        name: 'escalating',
        scopes: [PERMISSIONS.ORGANIZATION_DELETE],
      }),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'validation' });
  });

  it('resolves the issuer permissions for the caller in their own organization', async () => {
    const authorization = authorizationHolding([PERMISSIONS.FILE_READ]);
    const handler = new CreateApiKeyHandler(repository, authorization);

    await handler.execute(
      new CreateApiKeyCommand({
        organizationId: ORG_ID,
        userId: USER_ID,
        name: 'CI bot',
        scopes: [PERMISSIONS.FILE_READ],
      }),
    );

    expect(authorization.permissionsFor).toHaveBeenCalledWith({
      type: 'user',
      userId: USER_ID,
      organizationId: ORG_ID,
    });
  });
});

describe('RevokeApiKeyHandler', () => {
  let repository: InMemoryApiKeyRepository;

  beforeEach(() => {
    repository = new InMemoryApiKeyRepository();
  });

  it('revokes a live key', async () => {
    const key = seedKey(repository);

    await new RevokeApiKeyHandler(repository).execute(new RevokeApiKeyCommand(ORG_ID, key.id));

    expect(repository.isRevoked(key.id)).toBe(true);
  });

  it('is a no-op when the key is already revoked', async () => {
    const key = seedKey(repository);
    const handler = new RevokeApiKeyHandler(repository);
    await handler.execute(new RevokeApiKeyCommand(ORG_ID, key.id));

    await expect(handler.execute(new RevokeApiKeyCommand(ORG_ID, key.id))).resolves.toBeUndefined();
  });

  it('answers not_found for a key of another organization', async () => {
    const key = seedKey(repository, OTHER_ORG_ID);

    const execute = new RevokeApiKeyHandler(repository).execute(
      new RevokeApiKeyCommand(ORG_ID, key.id),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('answers not_found for an unknown key', async () => {
    const execute = new RevokeApiKeyHandler(repository).execute(
      new RevokeApiKeyCommand(ORG_ID, generateId()),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'not_found' });
  });
});

describe('ListApiKeysHandler', () => {
  let repository: InMemoryApiKeyRepository;

  beforeEach(() => {
    repository = new InMemoryApiKeyRepository();
  });

  it('never projects the stored digest', async () => {
    seedKey(repository);

    const result = await new ListApiKeysHandler(repository).execute(
      new ListApiKeysQuery(ORG_ID, 20),
    );

    expect(result.data).toHaveLength(1);
    expect(Object.keys(result.data[0])).not.toContain('keyHash');
    expect(Object.keys(result.data[0])).not.toContain('key');
  });

  it('hides revoked keys unless asked for them', async () => {
    const key = seedKey(repository);
    await repository.revoke(ORG_ID, key.id);
    const handler = new ListApiKeysHandler(repository);

    const hidden = await handler.execute(new ListApiKeysQuery(ORG_ID, 20));
    const shown = await handler.execute(new ListApiKeysQuery(ORG_ID, 20, { includeRevoked: true }));

    expect(hidden.data).toHaveLength(0);
    expect(shown.data).toHaveLength(1);
  });

  it('rejects a malformed cursor', async () => {
    const execute = new ListApiKeysHandler(repository).execute(
      new ListApiKeysQuery(ORG_ID, 20, { startingAfter: 'nope!' }),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'malformed' });
  });
});
