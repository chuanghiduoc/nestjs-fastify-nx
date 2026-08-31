import { ApiProperty } from '@nestjs/swagger';

export class AuditLogResponseDto {
  @ApiProperty({ format: 'uuid', description: 'Audit entry id (UUID v7).' })
  id!: string;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    type: String,
    description: 'Organization the entry belongs to.',
  })
  organizationId!: string | null;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    type: String,
    description: 'User the entry is attributed to, when the action had one.',
  })
  userId!: string | null;

  @ApiProperty({
    description: 'Domain event name that produced the entry.',
    example: 'users.registered',
  })
  action!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Resource label the action applied to.',
    example: 'user',
  })
  resource!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Event payload captured at record time, minus the fields promoted to columns.',
  })
  metadata!: Record<string, unknown>;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Client IP captured at record time.',
    example: '203.0.113.42',
  })
  ipAddress!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Client user agent captured at record time.',
  })
  userAgent!: string | null;

  @ApiProperty({ type: String, format: 'date-time', description: 'When the action occurred.' })
  createdAt!: Date;
}
