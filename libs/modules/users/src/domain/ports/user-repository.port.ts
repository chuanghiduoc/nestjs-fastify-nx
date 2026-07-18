import type { DecodedCursor } from '@nestjs-fastify-nx/shared';
import type { User, UserRole, UserStatus } from '../entities/user.entity';

export const USER_REPOSITORY_PORT = Symbol('USER_REPOSITORY_PORT');

export interface FindAllCursorOptions {
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
