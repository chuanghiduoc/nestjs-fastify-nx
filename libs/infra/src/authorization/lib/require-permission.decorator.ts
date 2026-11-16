import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@nestjs-fastify-nx/shared';

export const REQUIRED_PERMISSIONS_KEY = 'required_permissions';

export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
