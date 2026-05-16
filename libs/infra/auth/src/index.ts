export { createBetterAuth } from './lib/better-auth.config';
export type { BetterAuthInstance, BetterAuthHooks } from './lib/better-auth.config';
export type { AuthenticatedSession } from './lib/better-auth.types';
export { BETTER_AUTH_INSTANCE } from './lib/better-auth-instance.token';
export { BetterAuthModule } from './lib/better-auth.module';
export { BetterAuthGuard } from './lib/better-auth.guard';
export { RolesGuard } from './lib/roles.guard';
export { Roles, ROLES_KEY } from './lib/roles.decorator';
export { Public, IS_PUBLIC_KEY } from './lib/public.decorator';
