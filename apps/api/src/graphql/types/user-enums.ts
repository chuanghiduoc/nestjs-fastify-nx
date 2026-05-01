import { registerEnumType } from '@nestjs/graphql';
import { UserRole, UserStatus } from '@nestjs-fastify-nx/modules-users';

registerEnumType(UserRole, { name: 'UserRole' });
registerEnumType(UserStatus, { name: 'UserStatus' });

export { UserRole, UserStatus };
