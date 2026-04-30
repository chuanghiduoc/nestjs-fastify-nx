import { DynamicModule, Global, Module, type ModuleMetadata, type Type } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { createBetterAuth, type BetterAuthHooks } from './better-auth.config';
import { BETTER_AUTH_INSTANCE } from './better-auth-instance.token';
import { BetterAuthGuard } from './better-auth.guard';
import { RolesGuard } from './roles.guard';

const BETTER_AUTH_HOOKS = Symbol('BETTER_AUTH_HOOKS');

export interface BetterAuthModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  // Mirrors NestJS's own `useFactory` signature on dynamic modules: the
  // resolved injection list is positional and per-call, so the public type
  // must accept `any[]` for the host to map them to typed parameters.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useFactory: (...args: any[]) => Promise<BetterAuthHooks> | BetterAuthHooks;
  inject?: Array<Type<unknown> | string | symbol>;
}

@Global()
@Module({
  providers: [
    {
      provide: BETTER_AUTH_HOOKS,
      useValue: {} satisfies BetterAuthHooks,
    },
    {
      provide: BETTER_AUTH_INSTANCE,
      useFactory: (prisma: PrismaService, hooks: BetterAuthHooks) =>
        createBetterAuth(prisma.db, hooks),
      inject: [PrismaService, BETTER_AUTH_HOOKS],
    },
    BetterAuthGuard,
    RolesGuard,
  ],
  exports: [BETTER_AUTH_INSTANCE, BetterAuthGuard, RolesGuard],
})
export class BetterAuthModule {
  /**
   * Async configuration entry-point. Lets the host application inject a
   * publisher (e.g. `EVENT_PUBLISHER_PORT`) and translate Better Auth's raw
   * row callbacks into domain events without coupling `infra-auth` to any
   * feature module.
   */
  static forRootAsync(options: BetterAuthModuleAsyncOptions): DynamicModule {
    return {
      module: BetterAuthModule,
      global: true,
      imports: options.imports ?? [],
      providers: [
        {
          provide: BETTER_AUTH_HOOKS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
        {
          provide: BETTER_AUTH_INSTANCE,
          useFactory: (prisma: PrismaService, hooks: BetterAuthHooks) =>
            createBetterAuth(prisma.db, hooks),
          inject: [PrismaService, BETTER_AUTH_HOOKS],
        },
        BetterAuthGuard,
        RolesGuard,
      ],
      exports: [BETTER_AUTH_INSTANCE, BetterAuthGuard, RolesGuard],
    };
  }
}
