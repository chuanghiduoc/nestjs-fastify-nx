import { ApiProperty } from '@nestjs/swagger';

export class TokenPairDto {
  @ApiProperty({ description: 'JWT access token (15m TTL)', example: 'eyJhbGc...' })
  accessToken!: string;

  @ApiProperty({ description: 'JWT refresh token (7d TTL)', example: 'eyJhbGc...' })
  refreshToken!: string;
}

export class UserProfileResponseDto {
  @ApiProperty({
    description: 'User UUID v7 identifier',
    example: '019dd1a5-9235-70db-8d57-54ef901d8185',
  })
  id!: string;

  @ApiProperty({ description: 'User email address', example: 'user@example.com' })
  email!: string;

  @ApiProperty({ description: 'User role', example: 'USER', enum: ['USER', 'ADMIN'] })
  role!: string;

  @ApiProperty({ description: 'Account creation timestamp', example: '2024-01-01T00:00:00.000Z' })
  createdAt!: Date;
}
