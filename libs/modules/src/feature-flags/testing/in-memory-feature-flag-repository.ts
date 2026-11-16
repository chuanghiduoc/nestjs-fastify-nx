import { paginateNewestFirst } from '@nestjs-fastify-nx/shared';
import { FeatureFlag, type FeatureFlagChanges } from '../domain/entities/feature-flag.entity';
import type {
  FeatureFlagRepositoryPort,
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

  update(
    organizationId: string,
    id: string,
    changes: FeatureFlagChanges,
    updatedAt: Date,
  ): Promise<boolean> {
    const flag = this.flags.get(id);
    if (!flag || flag.organizationId !== organizationId) return Promise.resolve(false);

    const merged = flag.withChanges(changes);
    this.flags.set(
      id,
      FeatureFlag.reconstitute({
        id: merged.id,
        organizationId: merged.organizationId,
        key: merged.key,
        description: merged.description,
        enabled: merged.enabled,
        rolloutPercentage: merged.rolloutPercentage,
        createdAt: merged.createdAt,
        updatedAt,
      }),
    );
    return Promise.resolve(true);
  }

  delete(organizationId: string, id: string): Promise<boolean> {
    const flag = this.flags.get(id);
    if (!flag || flag.organizationId !== organizationId) return Promise.resolve(false);
    return Promise.resolve(this.flags.delete(id));
  }
}
