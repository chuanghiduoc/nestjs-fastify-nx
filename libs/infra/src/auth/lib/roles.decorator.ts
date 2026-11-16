import { SetMetadata } from '@nestjs/common';
import type { PlatformRole } from '@nestjs-fastify-nx/shared';

export const ROLES_KEY = 'roles';

export const Roles = (...roles: PlatformRole[]) => SetMetadata(ROLES_KEY, roles);
