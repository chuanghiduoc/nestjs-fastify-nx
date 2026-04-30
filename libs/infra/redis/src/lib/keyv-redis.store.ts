import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import KeyvRedis from '@keyv/redis';

export const KEYV_REDIS_STORE = Symbol('KEYV_REDIS_STORE');

@Injectable()
export class KeyvRedisStore implements OnModuleDestroy {
  private readonly logger = new Logger('KeyvRedis');
  private readonly store: KeyvRedis<unknown>;

  constructor(@Inject(ConfigService) config: ConfigService) {
    const host = config.get<string>('REDIS_CACHE_HOST', 'localhost');
    const port = config.get<number>('REDIS_CACHE_PORT', 6379);
    this.store = new KeyvRedis(`redis://${host}:${port}`);
    this.store.on('error', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`KeyvRedis error: ${message}`);
    });
  }

  getStore(): KeyvRedis<unknown> {
    return this.store;
  }

  async onModuleDestroy(): Promise<void> {
    await this.store.disconnect().catch(() => undefined);
  }
}
