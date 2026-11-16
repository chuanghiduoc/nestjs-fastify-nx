import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { FastifyRequest } from 'fastify';
import { RolesGuard, type AuthenticatedSession } from '@nestjs-fastify-nx/infra-auth';
import { REQUIRED_PERMISSIONS_KEY } from '@nestjs-fastify-nx/infra-authorization';
import { generateId } from '@nestjs-fastify-nx/shared';
import { TERM_TYPE } from './term.entity';
import { TermsController } from './terms.controller';
import { CreateTermDto } from './terms.dto';

const USER_ID = '019dd1a5-9235-70db-8d57-54ef92000001';

const SESSION: AuthenticatedSession = {
  userId: USER_ID,
  email: 'member@example.com',
  name: 'Member',
  role: 'USER',
  status: 'ACTIVE',
  sessionId: 's-1',
  organizationId: '019dd1a5-9235-70db-8d57-54ef92000002',
};

describe('TermsController platform gating', () => {
  function contextFor(
    handler: (...args: never[]) => unknown,
    user: AuthenticatedSession,
  ): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => TermsController,
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
  }

  const guard = new RolesGuard(new Reflector());
  const platformAdmin: AuthenticatedSession = { ...SESSION, role: 'ADMIN' };

  it.each([
    ['create', TermsController.prototype.create],
    ['publish', TermsController.prototype.publish],
  ])('refuses %s to a tenant owner without the platform ADMIN role', (_name, handler) => {
    expect(() => guard.canActivate(contextFor(handler, SESSION))).toThrow(ForbiddenException);
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler)).toBeUndefined();
  });

  it.each([
    ['create', TermsController.prototype.create],
    ['publish', TermsController.prototype.publish],
  ])('admits %s to a platform ADMIN', (_name, handler) => {
    expect(guard.canActivate(contextFor(handler, platformAdmin))).toBe(true);
  });

  it('keeps the read and accept routes on the organization axis', () => {
    for (const handler of [
      TermsController.prototype.list,
      TermsController.prototype.acceptances,
      TermsController.prototype.latest,
      TermsController.prototype.accept,
    ]) {
      expect(guard.canActivate(contextFor(handler, SESSION))).toBe(true);
      expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler)).toBeDefined();
    }
  });
});

describe('TermsController', () => {
  function build() {
    const queryBus = { execute: vi.fn() };
    const commandBus = { execute: vi.fn() };
    return {
      queryBus,
      commandBus,
      controller: new TermsController(
        queryBus as unknown as QueryBus,
        commandBus as unknown as CommandBus,
      ),
    };
  }

  it('returns published terms in a flat list envelope', async () => {
    const { queryBus, controller } = build();
    queryBus.execute.mockResolvedValue({ data: [{ id: generateId() }] });

    const response = await controller.list();

    expect(response.object).toBe('list');
    expect(response.url).toBe('/api/v1/terms');
  });

  it('lists the acceptances of the calling user', async () => {
    const { queryBus, controller } = build();
    queryBus.execute.mockResolvedValue({ data: [] });

    const response = await controller.acceptances(SESSION);

    expect(response.url).toBe('/api/v1/terms/acceptances');
    expect(queryBus.execute).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID }));
  });

  it('reads the latest version of a type', async () => {
    const { queryBus, controller } = build();
    queryBus.execute.mockResolvedValue({ version: 'v1' });

    await controller.latest(TERM_TYPE.PRIVACY_POLICY);

    expect(queryBus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ type: TERM_TYPE.PRIVACY_POLICY }),
    );
  });

  it('dispatches create, publish and accept commands', async () => {
    const { commandBus, controller } = build();
    commandBus.execute.mockResolvedValue({});
    const id = generateId();

    await controller.create(
      Object.assign(new CreateTermDto(), {
        type: TERM_TYPE.TERMS_OF_SERVICE,
        version: 'v1',
        content: 'body',
        publish: true,
      }),
    );
    await controller.publish(id);
    await controller.accept(SESSION, id, { ip: '203.0.113.4' } as FastifyRequest);

    expect(commandBus.execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ version: 'v1', publish: true }),
    );
    expect(commandBus.execute).toHaveBeenNthCalledWith(2, expect.objectContaining({ id }));
    expect(commandBus.execute).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        userId: USER_ID,
        termId: id,
        ipAddress: '203.0.113.4',
      }),
    );
  });
});
