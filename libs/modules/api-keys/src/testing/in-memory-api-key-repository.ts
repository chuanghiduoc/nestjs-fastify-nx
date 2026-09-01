import type { ApiKey } from '../domain/entities/api-key.entity';
import type {
  ApiKeyRepositoryPort,
  FindApiKeysCursorOptions,
  FindApiKeysCursorResult,
} from '../domain/ports/api-key-repository.port';

export class InMemoryApiKeyRepository implements ApiKeyRepositoryPort {
  private readonly keys = new Map<string, ApiKey>();
  private readonly revoked = new Map<string, Date>();

  seed(apiKey: ApiKey): void {
    this.keys.set(apiKey.id, apiKey);
  }

  findAllCursor(options: FindApiKeysCursorOptions): Promise<FindApiKeysCursorResult> {
    const matching = [...this.keys.values()]
      .filter((key) => key.organizationId === options.organizationId)
      .filter((key) => options.includeRevoked || !this.revoked.has(key.id))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

    return Promise.resolve({
      items: matching.slice(0, options.limit),
      hasMore: matching.length > options.limit,
    });
  }

  create(apiKey: ApiKey): Promise<void> {
    this.seed(apiKey);
    return Promise.resolve();
  }

  revoke(organizationId: string, id: string): Promise<boolean> {
    const key = this.keys.get(id);
    if (!key || key.organizationId !== organizationId || this.revoked.has(id)) {
      return Promise.resolve(false);
    }
    this.revoked.set(id, new Date());
    return Promise.resolve(true);
  }

  exists(organizationId: string, id: string): Promise<boolean> {
    const key = this.keys.get(id);
    return Promise.resolve(key !== undefined && key.organizationId === organizationId);
  }

  isRevoked(id: string): boolean {
    return this.revoked.has(id);
  }
}
