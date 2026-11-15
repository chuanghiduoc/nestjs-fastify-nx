import type { UserStatus } from './user.entity';

export interface UserListItemDto {
  id: string;
  email: string;
  name: string;
  role: string;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}
