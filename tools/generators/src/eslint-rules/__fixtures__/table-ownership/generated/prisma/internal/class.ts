import type { FeatureFlagDelegate } from '../models/FeatureFlag';
import type { MemberDelegate } from '../models/Member';
import type { UserDelegate } from '../models/User';

export interface PrismaClient {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $transaction<R>(fn: (client: Omit<PrismaClient, '$transaction'>) => Promise<R>): Promise<R>;
  get user(): UserDelegate;
  get member(): MemberDelegate;
  get featureFlag(): FeatureFlagDelegate;
}
