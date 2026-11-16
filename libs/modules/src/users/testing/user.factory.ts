import { User, UserRole, UserStatus } from '../domain/entities/user.entity';
import { generateId } from '@nestjs-fastify-nx/shared';

let counter = 0;

export class UserFactory {
  static create(
    overrides: Partial<{
      email: string;
      name: string;
      role: UserRole;
      status: UserStatus;
    }> = {},
  ): User {
    counter++;
    return User.reconstitute({
      id: generateId(),
      email: overrides.email ?? `user${counter}@test.com`,
      name: overrides.name ?? `User ${counter}`,
      role: overrides.role ?? UserRole.USER,
      status: overrides.status ?? UserStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  static createAdmin(overrides: Partial<{ email: string }> = {}): User {
    return UserFactory.create({ ...overrides, role: UserRole.ADMIN });
  }

  static reset(): void {
    counter = 0;
  }
}
