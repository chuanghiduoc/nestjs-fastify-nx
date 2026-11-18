import type { PrismaClient } from './internal/class';

export type { PrismaClient } from './internal/class';
export type { UserWhereInput } from './models/User';

export type TransactionClient = Parameters<PrismaClient['$transaction']>[0] extends (
  client: infer TX,
) => Promise<unknown>
  ? TX
  : never;
