import { ApiProperty } from '@nestjs/swagger';
import { UserRole, UserStatus } from '../../domain/entities/user.entity';

export class UserProfileResponseDto {
  @ApiProperty({
    description: 'User UUID v7 identifier (sortable, time-prefixed).',
    example: '019dd1a5-9235-70db-8d57-54ef901d8185',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({ description: 'User email address.', example: 'user@example.com', format: 'email' })
  email!: string;

  @ApiProperty({ description: 'Display name.', example: 'Jane Doe' })
  name!: string;

  @ApiProperty({
    description: 'Authorization role granted to the user.',
    enum: UserRole,
    example: UserRole.USER,
  })
  role!: UserRole;

  @ApiProperty({
    description: 'Account lifecycle status.',
    enum: UserStatus,
    example: UserStatus.ACTIVE,
  })
  status!: UserStatus;

  @ApiProperty({
    description: 'Account creation timestamp (ISO 8601 UTC).',
    example: '2026-04-30T22:28:27.356Z',
    format: 'date-time',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Last modification timestamp (ISO 8601 UTC).',
    example: '2026-04-30T22:28:27.356Z',
    format: 'date-time',
  })
  updatedAt!: Date;
}

export class UserListItemResponseDto {
  @ApiProperty({
    description: 'User UUID v7 identifier.',
    example: '019dd1a5-9235-70db-8d57-54ef901d8185',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({ example: 'user@example.com', format: 'email' })
  email!: string;

  @ApiProperty({ description: 'Display name.', example: 'Jane Doe' })
  name!: string;

  @ApiProperty({ enum: UserRole, example: UserRole.USER })
  role!: UserRole;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status!: UserStatus;

  @ApiProperty({ example: '2026-04-30T22:28:27.356Z', format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-04-30T22:28:27.356Z', format: 'date-time' })
  updatedAt!: Date;
}
