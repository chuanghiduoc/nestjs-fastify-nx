import type { UserStatus } from '../../domain/entities/user.entity';

export interface UserListItemDto {
  id: string;
  email: string;
  name: string;
  role: string;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}
