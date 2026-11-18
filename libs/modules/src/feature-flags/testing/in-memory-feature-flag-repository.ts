import { paginateNewestFirst } from '@nestjs-fastify-nx/shared';
import { FeatureFlag } from '../domain/entities/feature-flag.entity';
import type {
  FeatureFlagRepositoryPort,
  FeatureFlagUpdateOutcome,
  FindFeatureFlagsCursorOptions,
  FindFeatureFlagsCursorResult,
} from '../domain/ports/feature-flag-repository.port';

export class InMemoryFeatureFlagRepository implements FeatureFlagRepositoryPort {
  private readonly flags = new Map<string, FeatureFlag>();

  seed(flag: FeatureFlag): void {
    this.flags.set(flag.id, flag);
  }

  private scoped(organizationId: string): FeatureFlag[] {
    return [...this.flags.values()].filter((flag) => flag.organizationId === organizationId);
  }

  findAllCursor(options: FindFeatureFlagsCursorOptions): Promise<FindFeatureFlagsCursorResult> {
    return Promise.resolve(
      paginateNewestFirst(this.scoped(options.organizationId), {
        startingAfter: options.startingAfter,
        limit: options.limit,
      }),
    );
  }

  findAll(organizationId: string): Promise<FeatureFlag[]> {
    return Promise.resolve(this.scoped(organizationId));
  }

  findById(organizationId: string, id: string): Promise<FeatureFlag | null> {
    const flag = this.flags.get(id);
    return Promise.resolve(flag && flag.organizationId === organizationId ? flag : null);
  }

  create(flag: FeatureFlag): Promise<void> {
    this.seed(flag);
    return Promise.resolve();
  }

  update(flag: FeatureFlag): Promise<FeatureFlagUpdateOutcome> {
    const stored = this.flags.get(flag.id);
    if (!stored || stored.organizationId !== flag.organizationId) {
      return Promise.resolve('not_found');
    }
    if (stored.version !== flag.version) return Promise.resolve('stale');

    this.flags.set(
      flag.id,
      FeatureFlag.reconstitute({
        id: stored.id,
        organizationId: stored.organizationId,
        key: stored.key,
        description: flag.description,
        enabled: flag.enabled,
        rolloutPercentage: flag.rolloutPercentage,
        createdAt: stored.createdAt,
        updatedAt: flag.updatedAt,
        version: stored.version + 1,
      }),
    );
    return Promise.resolve('updated');
  }

  delete(organizationId: string, id: string): Promise<boolean> {
    const flag = this.flags.get(id);
    if (!flag || flag.organizationId !== organizationId) return Promise.resolve(false);
    return Promise.resolve(this.flags.delete(id));
  }
}
