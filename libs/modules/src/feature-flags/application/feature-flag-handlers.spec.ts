import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DomainException, type EventPublisherPort } from '@nestjs-fastify-nx/core';
import type { PrismaService } from '@nestjs-fastify-nx/infra/database';
import { DOMAIN_EVENTS, generateId } from '@nestjs-fastify-nx/shared';
import { FeatureFlag } from '../domain/entities/feature-flag.entity';
import type { FeatureFlagRepositoryPort } from '../domain/ports/feature-flag-repository.port';
import { InMemoryFeatureFlagRepository } from '../testing/in-memory-feature-flag-repository';
import { ListFeatureFlagsHandler } from './queries/list-feature-flags';
import { ListFeatureFlagsQuery } from './queries/list-feature-flags';
import { EvaluateFeatureFlagsHandler } from './queries/evaluate-feature-flags';
import { EvaluateFeatureFlagsQuery } from './queries/evaluate-feature-flags';
import { CreateFeatureFlagHandler } from './commands/create-feature-flag';
import { CreateFeatureFlagCommand } from './commands/create-feature-flag';
import { UpdateFeatureFlagHandler } from './commands/update-feature-flag';
import { UpdateFeatureFlagCommand } from './commands/update-feature-flag';
import { DeleteFeatureFlagHandler } from './commands/delete-feature-flag';
import { DeleteFeatureFlagCommand } from './commands/delete-feature-flag';
import {
  featureFlagCreatedPayloadSchema,
  featureFlagDeletedPayloadSchema,
  featureFlagUpdatedPayloadSchema,
} from '../contract';

const ORG_ID = '019dd1a5-9235-70db-8d57-54ef91200001';
const OTHER_ORG_ID = '019dd1a5-9235-70db-8d57-54ef91200002';
const SUBJECT_ID = '019dd1a5-9235-70db-8d57-54ef91200003';
const ACTOR_ID = '019dd1a5-9235-70db-8d57-54ef91200004';

const prismaDouble = {
  transaction: (fn: () => Promise<unknown>) => fn(),
} as unknown as PrismaService;

function eventsDouble(): EventPublisherPort & { publish: ReturnType<typeof vi.fn> } {
  return {
    publish: vi.fn(),
    publishAll: vi.fn(),
  } as unknown as EventPublisherPort & { publish: ReturnType<typeof vi.fn> };
}

function publishedPayload(events: ReturnType<typeof eventsDouble>): unknown {
  const [event] = events.publish.mock.calls[0] as [{ payload: unknown }];
  return event.payload;
}

describe('feature flag handlers', () => {
  let repository: InMemoryFeatureFlagRepository;
  let events: ReturnType<typeof eventsDouble>;

  beforeEach(() => {
    repository = new InMemoryFeatureFlagRepository();
    events = eventsDouble();
  });

  it('creates a flag', async () => {
    const created = await new CreateFeatureFlagHandler(repository, prismaDouble, events).execute(
      new CreateFeatureFlagCommand({
        organizationId: ORG_ID,
        userId: ACTOR_ID,
        key: 'checkout.new-flow',
      }),
    );

    expect(created.key).toBe('checkout.new-flow');
    expect(await repository.findById(ORG_ID, created.id)).not.toBeNull();
  });

  it('records an audit event atomically with the flag write', async () => {
    await new CreateFeatureFlagHandler(repository, prismaDouble, events).execute(
      new CreateFeatureFlagCommand({
        organizationId: ORG_ID,
        userId: ACTOR_ID,
        key: 'audited.flag',
      }),
    );

    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: DOMAIN_EVENTS.FEATURE_FLAGS_CREATED,
        organizationId: ORG_ID,
        payload: expect.objectContaining({ userId: ACTOR_ID, key: 'audited.flag' }),
      }),
    );
  });

  it('publishes a created payload that satisfies its contract', async () => {
    await new CreateFeatureFlagHandler(repository, prismaDouble, events).execute(
      new CreateFeatureFlagCommand({ organizationId: ORG_ID, userId: ACTOR_ID, key: 'new.flag' }),
    );

    expect(featureFlagCreatedPayloadSchema.safeParse(publishedPayload(events)).success).toBe(true);
  });

  it('publishes an updated payload that satisfies its contract', async () => {
    const flag = FeatureFlag.create({ organizationId: ORG_ID, key: 'checkout.new-flow' });
    repository.seed(flag);

    await new UpdateFeatureFlagHandler(repository, prismaDouble, events).execute(
      new UpdateFeatureFlagCommand({
        organizationId: ORG_ID,
        userId: ACTOR_ID,
        id: flag.id,
        rolloutPercentage: 25,
      }),
    );

    expect(featureFlagUpdatedPayloadSchema.safeParse(publishedPayload(events)).success).toBe(true);
  });

  it('publishes a deleted payload that satisfies its contract', async () => {
    const flag = FeatureFlag.create({ organizationId: ORG_ID, key: 'checkout.new-flow' });
    repository.seed(flag);

    await new DeleteFeatureFlagHandler(repository, prismaDouble, events).execute(
      new DeleteFeatureFlagCommand(ORG_ID, ACTOR_ID, flag.id),
    );

    expect(featureFlagDeletedPayloadSchema.safeParse(publishedPayload(events)).success).toBe(true);
  });

  it('lists flags scoped to the organization', async () => {
    repository.seed(FeatureFlag.create({ organizationId: ORG_ID, key: 'mine.flag' }));
    repository.seed(FeatureFlag.create({ organizationId: OTHER_ORG_ID, key: 'theirs.flag' }));

    const result = await new ListFeatureFlagsHandler(repository).execute(
      new ListFeatureFlagsQuery(ORG_ID, 20),
    );

    expect(result.data.map((flag) => flag.key)).toEqual(['mine.flag']);
  });

  it('rejects a malformed cursor', async () => {
    const execute = new ListFeatureFlagsHandler(repository).execute(
      new ListFeatureFlagsQuery(ORG_ID, 20, 'bad cursor'),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'malformed' });
  });

  it('resolves every flag of the organization for a subject', async () => {
    repository.seed(FeatureFlag.create({ organizationId: ORG_ID, key: 'on.flag', enabled: true }));
    repository.seed(
      FeatureFlag.create({ organizationId: ORG_ID, key: 'off.flag', enabled: false }),
    );
    repository.seed(
      FeatureFlag.create({ organizationId: OTHER_ORG_ID, key: 'other.flag', enabled: true }),
    );

    const result = await new EvaluateFeatureFlagsHandler(repository).execute(
      new EvaluateFeatureFlagsQuery(ORG_ID, SUBJECT_ID),
    );

    expect(result.flags).toEqual({ 'on.flag': true, 'off.flag': false });
  });

  it('updates only the fields present in the payload', async () => {
    const flag = FeatureFlag.create({
      organizationId: ORG_ID,
      key: 'checkout.new-flow',
      description: 'before',
      rolloutPercentage: 40,
    });
    repository.seed(flag);

    const updated = await new UpdateFeatureFlagHandler(repository, prismaDouble, events).execute(
      new UpdateFeatureFlagCommand({
        organizationId: ORG_ID,
        userId: ACTOR_ID,
        id: flag.id,
        enabled: true,
      }),
    );

    expect(updated.enabled).toBe(true);
    expect(updated.rolloutPercentage).toBe(40);
    expect(updated.description).toBe('before');
  });

  it('answers not_found when updating a flag of another organization', async () => {
    const flag = FeatureFlag.create({ organizationId: OTHER_ORG_ID, key: 'theirs.flag' });
    repository.seed(flag);

    const execute = new UpdateFeatureFlagHandler(repository, prismaDouble, events).execute(
      new UpdateFeatureFlagCommand({
        organizationId: ORG_ID,
        userId: ACTOR_ID,
        id: flag.id,
        enabled: true,
      }),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('answers not_found when the flag is deleted between the read and the write', async () => {
    const flag = FeatureFlag.create({ organizationId: ORG_ID, key: 'checkout.new-flow' });
    repository.seed(flag);
    await repository.delete(ORG_ID, flag.id);
    const staleRead: FeatureFlagRepositoryPort = {
      findAllCursor: (options) => repository.findAllCursor(options),
      findAll: (organizationId) => repository.findAll(organizationId),
      findById: async () => flag,
      create: (f) => repository.create(f),
      update: (f) => repository.update(f),
      delete: (organizationId, id) => repository.delete(organizationId, id),
    };

    const execute = new UpdateFeatureFlagHandler(staleRead, prismaDouble, events).execute(
      new UpdateFeatureFlagCommand({
        organizationId: ORG_ID,
        userId: ACTOR_ID,
        id: flag.id,
        enabled: true,
      }),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('answers a retryable conflict when the flag changed between the read and the write', async () => {
    const flag = FeatureFlag.create({ organizationId: ORG_ID, key: 'checkout.new-flow' });
    repository.seed(flag);
    await repository.update(flag.withChanges({ rolloutPercentage: 10 }));
    const staleRead: FeatureFlagRepositoryPort = {
      findAllCursor: (options) => repository.findAllCursor(options),
      findAll: (organizationId) => repository.findAll(organizationId),
      findById: async () => flag,
      create: (f) => repository.create(f),
      update: (f) => repository.update(f),
      delete: (organizationId, id) => repository.delete(organizationId, id),
    };

    const execute = new UpdateFeatureFlagHandler(staleRead, prismaDouble, events).execute(
      new UpdateFeatureFlagCommand({
        organizationId: ORG_ID,
        userId: ACTOR_ID,
        id: flag.id,
        enabled: true,
      }),
    );

    await expect(execute).rejects.toBeInstanceOf(DomainException);
    await expect(execute).rejects.toMatchObject({
      kind: 'conflict',
      code: 'conflict',
      permanent: false,
    });
    expect(events.publish).not.toHaveBeenCalled();
    expect((await repository.findById(ORG_ID, flag.id))?.rolloutPercentage).toBe(10);
  });

  it('deletes a flag and reports not_found on the second call', async () => {
    const flag = FeatureFlag.create({ organizationId: ORG_ID, key: 'checkout.new-flow' });
    repository.seed(flag);
    const handler = new DeleteFeatureFlagHandler(repository, prismaDouble, events);

    await handler.execute(new DeleteFeatureFlagCommand(ORG_ID, ACTOR_ID, flag.id));

    await expect(
      handler.execute(new DeleteFeatureFlagCommand(ORG_ID, ACTOR_ID, flag.id)),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('answers not_found when deleting an unknown flag', async () => {
    const execute = new DeleteFeatureFlagHandler(repository, prismaDouble, events).execute(
      new DeleteFeatureFlagCommand(ORG_ID, ACTOR_ID, generateId()),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'not_found' });
  });
});

describe('InMemoryFeatureFlagRepository', () => {
  let repository: InMemoryFeatureFlagRepository;

  beforeEach(() => {
    repository = new InMemoryFeatureFlagRepository();
  });

  it('writes the changed fields and bumps the version', async () => {
    const flag = FeatureFlag.create({
      organizationId: ORG_ID,
      key: 'checkout.new-flow',
      description: 'before',
      rolloutPercentage: 40,
    });
    repository.seed(flag);
    const changed = flag.withChanges({ enabled: true });

    expect(await repository.update(changed)).toBe('updated');
    const stored = await repository.findById(ORG_ID, flag.id);
    expect(stored?.enabled).toBe(true);
    expect(stored?.rolloutPercentage).toBe(40);
    expect(stored?.description).toBe('before');
    expect(stored?.updatedAt).toEqual(changed.updatedAt);
    expect(stored?.version).toBe(flag.version + 1);
  });

  it('reports stale when the stored version moved past the expected one', async () => {
    const flag = FeatureFlag.create({ organizationId: ORG_ID, key: 'checkout.new-flow' });
    repository.seed(flag);

    expect(await repository.update(flag.withChanges({ enabled: true }))).toBe('updated');
    expect(await repository.update(flag.withChanges({ rolloutPercentage: 5 }))).toBe('stale');
    expect((await repository.findById(ORG_ID, flag.id))?.rolloutPercentage).toBe(100);
  });

  it('reports not_found when the row no longer exists', async () => {
    const ghost = FeatureFlag.create({ organizationId: ORG_ID, key: 'ghost.flag' });

    expect(await repository.update(ghost)).toBe('not_found');
  });

  it('reports not_found for a row belonging to another organization', async () => {
    const flag = FeatureFlag.create({ organizationId: OTHER_ORG_ID, key: 'theirs.flag' });
    repository.seed(flag);
    const hijack = FeatureFlag.create({ id: flag.id, organizationId: ORG_ID, key: 'theirs.flag' });

    expect(await repository.update(hijack)).toBe('not_found');
  });

  it('resumes strictly after the cursor, tiebreaking on id among rows sharing a timestamp', async () => {
    const sameTime = new Date('2026-01-01T00:00:00.000Z');
    const idA = '01900000-0000-7000-8000-000000000001';
    const idB = '01900000-0000-7000-8000-000000000002';
    const base = {
      organizationId: ORG_ID,
      description: null,
      enabled: true,
      rolloutPercentage: 100,
      createdAt: sameTime,
      updatedAt: sameTime,
      version: 0,
    };
    repository.seed(FeatureFlag.reconstitute({ ...base, id: idA, key: 'a.flag' }));
    repository.seed(FeatureFlag.reconstitute({ ...base, id: idB, key: 'b.flag' }));

    const page = await repository.findAllCursor({
      organizationId: ORG_ID,
      limit: 10,
      startingAfter: { createdAt: sameTime, id: idB },
    });

    expect(page.items.map((flag) => flag.id)).toEqual([idA]);
  });
});
