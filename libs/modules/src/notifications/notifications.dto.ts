import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { CursorPaginationDto } from '@nestjs-fastify-nx/contracts';

export class ListNotificationsFilterDto extends CursorPaginationDto {
  @ApiPropertyOptional({
    description: 'Return only notifications that have not been read yet.',
    type: Boolean,
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unreadOnly?: boolean;
}

export class NotificationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Notification type key.', example: 'organization.member_added' })
  type!: string;

  @ApiProperty({ example: 'Welcome to the organization' })
  title!: string;

  @ApiProperty({ example: 'You were added as a member.' })
  body!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Type-specific payload.',
  })
  data!: Record<string, unknown>;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class UnreadCountResponseDto {
  @ApiProperty({ description: 'Number of unread notifications for the caller.', example: 3 })
  unread!: number;
}

export class MarkAllReadResponseDto {
  @ApiProperty({ description: 'How many notifications this call moved to read.', example: 12 })
  marked!: number;
}
