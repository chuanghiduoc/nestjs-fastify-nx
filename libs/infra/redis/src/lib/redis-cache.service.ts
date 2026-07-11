import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

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
