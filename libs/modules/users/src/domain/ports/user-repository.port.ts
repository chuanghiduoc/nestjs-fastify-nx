import type { User, UserRole, UserStatus } from '../entities/user.entity';

export const USER_REPOSITORY_PORT = Symbol('USER_REPOSITORY_PORT');

export interface FindAllOptions {
  page: number;
  pageSize: number;
  role?: UserRole;
  status?: UserStatus;
  search?: string;
}

export interface FindAllResult {
  items: User[];
  total: number;
}

export interface UserRepositoryPort {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findAll(options: FindAllOptions): Promise<FindAllResult>;
  save(user: User): Promise<void>;
  exists(email: string): Promise<boolean>;
}
