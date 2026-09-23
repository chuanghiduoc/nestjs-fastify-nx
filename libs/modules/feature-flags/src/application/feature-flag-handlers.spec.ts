import { beforeEach, describe, expect, it } from 'vitest';
import { generateId } from '@nestjs-fastify-nx/shared';
import { FeatureFlag } from '../domain/entities/feature-flag.entity';
import type { FeatureFlagRepositoryPort } from '../domain/ports/feature-flag-repository.port';
import { InMemoryFeatureFlagRepository } from '../testing/in-memory-feature-flag-repository';
import { ListFeatureFlagsHandler } from './queries/list-feature-flags/list-feature-flags.handler';
import { ListFeatureFlagsQuery } from './queries/list-feature-flags/list-feature-flags.query';
import { EvaluateFeatureFlagsHandler } from './queries/evaluate-feature-flags/evaluate-feature-flags.handler';
import { EvaluateFeatureFlagsQuery } from './queries/evaluate-feature-flags/evaluate-feature-flags.query';
import { CreateFeatureFlagHandler } from './commands/create-feature-flag/create-feature-flag.handler';
import { CreateFeatureFlagCommand } from './commands/create-feature-flag/create-feature-flag.command';
import { UpdateFeatureFlagHandler } from './commands/update-feature-flag/update-feature-flag.handler';
import { UpdateFeatureFlagCommand } from './commands/update-feature-flag/update-feature-flag.command';
import { DeleteFeatureFlagHandler } from './commands/delete-feature-flag/delete-feature-flag.handler';
import { DeleteFeatureFlagCommand } from './commands/delete-feature-flag/delete-feature-flag.command';

const ORG_ID = '019dd1a5-9235-70db-8d57-54ef91200001';
const OTHER_ORG_ID = '019dd1a5-9235-70db-8d57-54ef91200002';
const SUBJECT_ID = '019dd1a5-9235-70db-8d57-54ef91200003';

describe('feature flag handlers', () => {
  let repository: InMemoryFeatureFlagRepository;

  beforeEach(() => {
    repository = new InMemoryFeatureFlagRepository();
  });

  it('creates a flag', async () => {
    const created = await new CreateFeatureFlagHandler(repository).execute(
      new CreateFeatureFlagCommand({ organizationId: ORG_ID, key: 'checkout.new-flow' }),
    );

    expect(created.key).toBe('checkout.new-flow');
    expect(await repository.findById(ORG_ID, created.id)).not.toBeNull();
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

    const updated = await new UpdateFeatureFlagHandler(repository).execute(
      new UpdateFeatureFlagCommand({ organizationId: ORG_ID, id: flag.id, enabled: true }),
    );

    expect(updated.enabled).toBe(true);
    expect(updated.rolloutPercentage).toBe(40);
    expect(updated.description).toBe('before');
  });

  it('answers not_found when updating a flag of another organization', async () => {
    const flag = FeatureFlag.create({ organizationId: OTHER_ORG_ID, key: 'theirs.flag' });
    repository.seed(flag);

    const execute = new UpdateFeatureFlagHandler(repository).execute(
      new UpdateFeatureFlagCommand({ organizationId: ORG_ID, id: flag.id, enabled: true }),
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
      update: (organizationId, id, changes, updatedAt) =>
        repository.update(organizationId, id, changes, updatedAt),
      delete: (organizationId, id) => repository.delete(organizationId, id),
    };

    const execute = new UpdateFeatureFlagHandler(staleRead).execute(
      new UpdateFeatureFlagCommand({ organizationId: ORG_ID, id: flag.id, enabled: true }),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('deletes a flag and reports not_found on the second call', async () => {
    const flag = FeatureFlag.create({ organizationId: ORG_ID, key: 'checkout.new-flow' });
    repository.seed(flag);
    const handler = new DeleteFeatureFlagHandler(repository);

    await handler.execute(new DeleteFeatureFlagCommand(ORG_ID, flag.id));

    await expect(
      handler.execute(new DeleteFeatureFlagCommand(ORG_ID, flag.id)),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('answers not_found when deleting an unknown flag', async () => {
    const execute = new DeleteFeatureFlagHandler(repository).execute(
      new DeleteFeatureFlagCommand(ORG_ID, generateId()),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'not_found' });
  });
});

describe('InMemoryFeatureFlagRepository', () => {
  let repository: InMemoryFeatureFlagRepository;

  beforeEach(() => {
    repository = new InMemoryFeatureFlagRepository();
  });

  it('writes only the given fields, leaving the rest untouched', async () => {
    const flag = FeatureFlag.create({
      organizationId: ORG_ID,
      key: 'checkout.new-flow',
      description: 'before',
      rolloutPercentage: 40,
    });
    repository.seed(flag);
    const updatedAt = new Date(flag.updatedAt.getTime() + 1000);

    const applied = await repository.update(ORG_ID, flag.id, { enabled: true }, updatedAt);

    expect(applied).toBe(true);
    const stored = await repository.findById(ORG_ID, flag.id);
    expect(stored?.enabled).toBe(true);
    expect(stored?.rolloutPercentage).toBe(40);
    expect(stored?.description).toBe('before');
    expect(stored?.updatedAt).toEqual(updatedAt);
  });

  it('reports false when the row no longer exists', async () => {
    expect(await repository.update(ORG_ID, generateId(), { enabled: true }, new Date())).toBe(
      false,
    );
  });

  it('reports false for a row belonging to another organization', async () => {
    const flag = FeatureFlag.create({ organizationId: OTHER_ORG_ID, key: 'theirs.flag' });
    repository.seed(flag);

    expect(await repository.update(ORG_ID, flag.id, { enabled: true }, new Date())).toBe(false);
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
