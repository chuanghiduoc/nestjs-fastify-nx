import type { DecodedCursor } from '@nestjs-fastify-nx/shared';
import type { User, UserRole, UserStatus } from '../entities/user.entity';

export const USER_REPOSITORY_PORT = Symbol('USER_REPOSITORY_PORT');

export interface FindAllCursorOptions {
  // Mandatory: `users` is global identity with no row-level security to fall back on, so an
  // implementation that forgets to scope this listing leaks every tenant's members.
  organizationId: string;
  // Already decoded by the application layer — implementations never parse a raw cursor string.
  startingAfter?: DecodedCursor;
  limit: number;
  role?: UserRole;
  status?: UserStatus;
  search?: string;
}

export interface FindAllCursorResult {
  items: User[];
  hasMore: boolean;
}

export interface UserRepositoryPort {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findAllCursor(options: FindAllCursorOptions): Promise<FindAllCursorResult>;
  save(user: User): Promise<void>;
  exists(email: string): Promise<boolean>;
}
