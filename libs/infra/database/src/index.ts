export { DatabaseModule } from './lib/database.module';
export { PrismaService, type TransactionClient } from './lib/prisma.service';
export { PrismaReplicationLagHealthIndicator } from './lib/prisma-replication-lag.health';

// Prisma 7 `prisma-client` generator emits the client into this lib's source tree
// (see prisma/schema.prisma `output`). Re-export it here so consumers depend on the
// database lib's public API instead of reaching into the generated path — keeps the
// generated client behind one project boundary and lets `tsc --build` resolve it
// through project-reference declarations.
export { PrismaClient, Prisma } from './generated/prisma/client';
export type {
  User,
  Session,
  Account,
  Verification,
  StoredFile,
  OutboxEvent,
  AuditLog,
} from './generated/prisma/client';
