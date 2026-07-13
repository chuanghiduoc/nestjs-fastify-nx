import { ApiProperty } from '@nestjs/swagger';
import type { PresignedUpload } from '@nestjs-fastify-nx/infra-storage';

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;

export class PresignedUploadDto implements PresignedUpload {
  @ApiProperty({
    description: 'Endpoint the browser POSTs the multipart form to.',
    example: 'https://s3.example.com/app-uploads',
    format: 'uri',
  })
  url!: string;

  @ApiProperty({
    description:
      'Form fields to include alongside the `file` part. Submit them in order — `file` MUST be last.',
    example: {
      'Content-Type': 'image/png',
      bucket: 'app-uploads',
      key: 'uploads/019dd1a5-9235-70db-8d57-54ef901d8185/019dd1a6-102a-7b25-a5a3-54b298b81864.png',
      Policy: '...',
      'X-Amz-Signature': '...',
    },
    additionalProperties: { type: 'string' },
  })
  fields!: Record<string, string>;

  @ApiProperty({
    description: 'Storage key the file will land under — pass back to /upload/confirm.',
    example:
      'uploads/019dd1a5-9235-70db-8d57-54ef901d8185/019dd1a6-102a-7b25-a5a3-54b298b81864.png',
  })
  key!: string;

  @ApiProperty({ description: 'Storage bucket the file will land in.', example: 'app-uploads' })
  bucket!: string;

  @ApiProperty({
    description: 'ISO timestamp after which the presigned policy is rejected by S3.',
    example: '2026-05-01T08:30:00.000Z',
    format: 'date-time',
  })
  expiresAt!: string;

  @ApiProperty({
    description: 'Maximum bytes the policy will accept — clients should validate locally too.',
    example: DEFAULT_MAX_FILE_SIZE,
  })
  maxBytes!: number;
}
