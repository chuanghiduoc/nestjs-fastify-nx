import type { FeatureFlag } from '../domain/entities/feature-flag.entity';
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
    const matching = this.scoped(options.organizationId).sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );

    return Promise.resolve({
      items: matching.slice(0, options.limit),
      hasMore: matching.length > options.limit,
    });
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

  update(flag: FeatureFlag): Promise<void> {
    this.seed(flag);
    return Promise.resolve();
  }

  delete(organizationId: string, id: string): Promise<boolean> {
    const flag = this.flags.get(id);
    if (!flag || flag.organizationId !== organizationId) return Promise.resolve(false);
    return Promise.resolve(this.flags.delete(id));
  }
}
