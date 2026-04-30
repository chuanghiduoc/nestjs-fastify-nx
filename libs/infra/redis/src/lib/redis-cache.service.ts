import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

/**
 * Thin, type-safe wrapper around NestJS CacheManager.
 *
 * All methods accept an optional `namespace` prefix so that different features
 * can share the same Redis instance without key collisions.  The separator is
 * `::` which is the same separator used by @keyv/redis internally.
 *
 * Error handling strategy: errors are logged and re-thrown so the caller can
 * decide whether the failure is fatal (e.g., return stale data instead).
 */
@Injectable()
export class RedisCacheService {
  private readonly logger = new Logger(RedisCacheService.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  private buildKey(key: string, namespace?: string): string {
    return namespace ? `${namespace}::${key}` : key;
  }

  async get<T>(key: string, namespace?: string): Promise<T | null> {
    try {
      return (await this.cache.get<T>(this.buildKey(key, namespace))) ?? null;
    } catch (err) {
      this.logger.error(`Cache GET failed for key "${key}"`, String(err));
      throw err;
    }
  }

  async set<T>(key: string, value: T, ttlMs?: number, namespace?: string): Promise<void> {
    try {
      await this.cache.set(this.buildKey(key, namespace), value, ttlMs);
    } catch (err) {
      this.logger.error(`Cache SET failed for key "${key}"`, String(err));
      throw err;
    }
  }

  async del(key: string, namespace?: string): Promise<void> {
    try {
      await this.cache.del(this.buildKey(key, namespace));
    } catch (err) {
      this.logger.error(`Cache DEL failed for key "${key}"`, String(err));
      throw err;
    }
  }

  async reset(): Promise<void> {
    try {
      await this.cache.clear();
    } catch (err) {
      this.logger.error('Cache RESET (clear) failed', String(err));
      throw err;
    }
  }
}
