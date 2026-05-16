import { Global, Module } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { createBetterAuth } from './better-auth.config';
import { BETTER_AUTH_INSTANCE } from './better-auth-instance.token';
import { BetterAuthGuard } from './better-auth.guard';
import { RolesGuard } from './roles.guard';

@Global()
@Module({
  providers: [
    {
      provide: BETTER_AUTH_INSTANCE,
      useFactory: (prisma: PrismaService) => createBetterAuth(prisma.db),
      inject: [PrismaService],
    },
    BetterAuthGuard,
    RolesGuard,
  ],
  exports: [BETTER_AUTH_INSTANCE, BetterAuthGuard, RolesGuard],
})
export class BetterAuthModule {}
