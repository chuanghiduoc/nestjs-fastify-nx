import { describe, it, expect, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { ClsService } from 'nestjs-cls';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { PERMISSIONS, generateApiKey, generateId, hashApiKey } from '@nestjs-fastify-nx/shared';
import { ApiKeyGuard } from './api-key.guard';
import { ALLOW_API_KEY_KEY } from './allow-api-key.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthenticatedApiKey } from './api-key.types';

// Minted through the production helper rather than hardcoded: a literal that looks like a
// live credential trips secret scanning, and this also pins the guard to the real key format.
const RAW_KEY = generateApiKey().raw;
const ORG_ID = generateId();
const CREDENTIAL_ID = generateId();

type RequestDouble = { headers: Record<string, string>; apiKey?: AuthenticatedApiKey };

function makeContext(
  headers: Record<string, string> = {},
  type: 'http' | 'ws' = 'http',
): { context: ExecutionContext; request: RequestDouble } {
  const request: RequestDouble = { headers };
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

// The guard asks the reflector two separate questions; a single mocked return value would make a
// route that is merely public look like one that opted into machine access.
function makeReflector(options: { isPublic?: boolean; allowApiKey?: boolean } = {}): Reflector {
  return {
    getAllAndOverride: vi.fn((key: string) => {
      if (key === IS_PUBLIC_KEY) return options.isPublic ?? false;
      if (key === ALLOW_API_KEY_KEY) return options.allowApiKey ?? false;
      return undefined;
    }),
  } as unknown as Reflector;
}

function makeCls(active = true): ClsService {
  return { isActive: () => active, set: vi.fn() } as unknown as ClsService;
}

function makePrisma(row: unknown, updateResult: Promise<unknown> = Promise.resolve({})) {
  const findUnique = vi.fn().mockResolvedValue(row);
  const update = vi.fn().mockReturnValue(updateResult);
  return {
    prisma: { db: { apiKey: { findUnique, update } } } as unknown as PrismaService,
    findUnique,
    update,
  };
}

function liveRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CREDENTIAL_ID,
    organizationId: ORG_ID,
    scopes: [PERMISSIONS.FEATURE_FLAG_READ],
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe('ApiKeyGuard', () => {
  it('passes through when no key is presented so the session guard can run', async () => {
    const { prisma, findUnique } = makePrisma(null);
    const { context, request } = makeContext();

    await expect(
      new ApiKeyGuard(makeReflector(), prisma, makeCls()).canActivate(context),
    ).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
    expect(request.apiKey).toBeUndefined();
  });

  it('ignores websocket contexts, which are authenticated at the socket layer', async () => {
    const { prisma, findUnique } = makePrisma(null);
    const { context } = makeContext({ 'x-api-key': RAW_KEY }, 'ws');

    await expect(
      new ApiKeyGuard(makeReflector(), prisma, makeCls()).canActivate(context),
    ).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('leaves a public route alone', async () => {
    const { prisma, findUnique } = makePrisma(null);
    const { context } = makeContext({ 'x-api-key': RAW_KEY });

    await expect(
      new ApiKeyGuard(makeReflector({ isPublic: true }), prisma, makeCls()).canActivate(context),
    ).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  // Refusing before the lookup is deliberate: it keeps the response from confirming whether the
  // key exists, and stops it reaching a handler that expects a session.
  it('refuses a key on a route that did not opt in, without touching the database', async () => {
    const { prisma, findUnique } = makePrisma(liveRow());
    const { context } = makeContext({ authorization: `Bearer ${RAW_KEY}` });

    await expect(
      new ApiKeyGuard(makeReflector({ allowApiKey: false }), prisma, makeCls()).canActivate(
        context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('looks the key up by digest, never by the raw value', async () => {
    const { prisma, findUnique } = makePrisma(liveRow());
    const { context } = makeContext({ authorization: `Bearer ${RAW_KEY}` });

    await new ApiKeyGuard(makeReflector({ allowApiKey: true }), prisma, makeCls()).canActivate(
      context,
    );

    expect(findUnique.mock.calls[0][0].where).toEqual({ keyHash: hashApiKey(RAW_KEY) });
    expect(JSON.stringify(findUnique.mock.calls[0][0])).not.toContain(RAW_KEY);
  });

  it('stamps the verified key and the tenant onto the request', async () => {
    const { prisma } = makePrisma(liveRow());
    const cls = makeCls();
    const { context, request } = makeContext({ authorization: `Bearer ${RAW_KEY}` });

    await expect(
      new ApiKeyGuard(makeReflector({ allowApiKey: true }), prisma, cls).canActivate(context),
    ).resolves.toBe(true);

    expect(request.apiKey).toEqual({
      apiKeyId: CREDENTIAL_ID,
      organizationId: ORG_ID,
      scopes: [PERMISSIONS.FEATURE_FLAG_READ],
    });
    expect(cls.set).toHaveBeenCalled();
  });

  it('accepts the key through the X-Api-Key header as well', async () => {
    const { prisma } = makePrisma(liveRow());
    const { context, request } = makeContext({ 'x-api-key': RAW_KEY });

    await new ApiKeyGuard(makeReflector({ allowApiKey: true }), prisma, makeCls()).canActivate(
      context,
    );

    expect(request.apiKey?.apiKeyId).toBe(CREDENTIAL_ID);
  });

  it('ignores an Authorization header that is not an api key', async () => {
    const { prisma, findUnique } = makePrisma(null);
    const { context } = makeContext({ authorization: 'Bearer some.jwt.looking.value' });

    await expect(
      new ApiKeyGuard(makeReflector({ allowApiKey: true }), prisma, makeCls()).canActivate(context),
    ).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('refuses an unknown key', async () => {
    const { prisma } = makePrisma(null);
    const { context } = makeContext({ 'x-api-key': RAW_KEY });

    await expect(
      new ApiKeyGuard(makeReflector({ allowApiKey: true }), prisma, makeCls()).canActivate(context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a revoked key', async () => {
    const { prisma } = makePrisma(liveRow({ revokedAt: new Date('2026-08-01T00:00:00.000Z') }));
    const { context } = makeContext({ 'x-api-key': RAW_KEY });

    await expect(
      new ApiKeyGuard(makeReflector({ allowApiKey: true }), prisma, makeCls()).canActivate(context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses an expired key', async () => {
    const { prisma } = makePrisma(liveRow({ expiresAt: new Date(Date.now() - 60_000) }));
    const { context } = makeContext({ 'x-api-key': RAW_KEY });

    await expect(
      new ApiKeyGuard(makeReflector({ allowApiKey: true }), prisma, makeCls()).canActivate(context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a key whose expiry is still ahead', async () => {
    const { prisma } = makePrisma(liveRow({ expiresAt: new Date(Date.now() + 60_000) }));
    const { context } = makeContext({ 'x-api-key': RAW_KEY });

    await expect(
      new ApiKeyGuard(makeReflector({ allowApiKey: true }), prisma, makeCls()).canActivate(context),
    ).resolves.toBe(true);
  });

  it('records last-used without awaiting it', async () => {
    const { prisma, update } = makePrisma(liveRow());
    const { context } = makeContext({ 'x-api-key': RAW_KEY });

    await new ApiKeyGuard(makeReflector({ allowApiKey: true }), prisma, makeCls()).canActivate(
      context,
    );

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: CREDENTIAL_ID } }));
  });

  // Telemetry must never fail the request it is describing.
  it('survives a failure while recording last-used', async () => {
    const { prisma } = makePrisma(liveRow(), Promise.reject(new Error('write failed')));
    const { context } = makeContext({ 'x-api-key': RAW_KEY });

    await expect(
      new ApiKeyGuard(makeReflector({ allowApiKey: true }), prisma, makeCls()).canActivate(context),
    ).resolves.toBe(true);
  });

  it('does not write to a closed CLS context', async () => {
    const { prisma } = makePrisma(liveRow());
    const cls = makeCls(false);
    const { context } = makeContext({ 'x-api-key': RAW_KEY });

    await new ApiKeyGuard(makeReflector({ allowApiKey: true }), prisma, cls).canActivate(context);

    expect(cls.set).not.toHaveBeenCalled();
  });
});
