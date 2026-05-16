import { defineConfig } from 'prisma/config';

// Driver adapter (PrismaPg) is configured at runtime in PrismaService,
// not here — `adapter` is not a valid PrismaConfig field in Prisma 7.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'] ?? '',
  },
});
