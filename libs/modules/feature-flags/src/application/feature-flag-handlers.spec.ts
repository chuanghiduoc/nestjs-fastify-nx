import { beforeEach, describe, expect, it } from 'vitest';
import { generateId } from '@nestjs-fastify-nx/shared';
import { FeatureFlag } from '../domain/entities/feature-flag.entity';
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
