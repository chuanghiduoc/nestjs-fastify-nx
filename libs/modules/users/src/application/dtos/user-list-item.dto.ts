import type { UserRole, UserStatus } from '../../domain/entities/user.entity';

export interface UserListItemDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}
