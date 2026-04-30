import { UserRole } from '../../domain/entities/user.entity';

export interface UserProfileDto {
  id: string;
  email: string;
  role: UserRole;
  createdAt: Date;
}
