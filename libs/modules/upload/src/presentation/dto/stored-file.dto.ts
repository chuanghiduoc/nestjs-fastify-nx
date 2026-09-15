import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { StoredFile } from '@nestjs-fastify-nx/infra-storage';
import { STORED_FILE_STATUS, type StoredFileStatus } from '@nestjs-fastify-nx/shared';

export class StoredFileDto implements StoredFile {
  @ApiProperty({ description: 'Stored-file identifier used by delete operations.' })
  id!: string;

  @ApiProperty({
    enum: Object.values(STORED_FILE_STATUS),
    description: 'READY files can be downloaded; VERIFYING files are awaiting malware scanning.',
  })
  status!: StoredFileStatus;

  @ApiProperty({
    description: 'Storage key under which the file was persisted.',
    example: 'files/019dd1a5-9235-70db-8d57-54ef901d8185/019dd1a6-102a-7b25-a5a3-54b298b81864.png',
  })
  key!: string;

  @ApiPropertyOptional({
    description: 'Signed download URL, present when the file is READY.',
    example:
      'https://cdn.example.com/files/019dd1a5-9235-70db-8d57-54ef901d8185/019dd1a6-102a-7b25-a5a3-54b298b81864.png',
    format: 'uri',
  })
  url?: string;

  @ApiProperty({ description: 'Storage bucket the file landed in.', example: 'app-uploads' })
  bucket!: string;

  @ApiProperty({ description: 'Size in bytes.', example: 12345 })
  size!: number;
}
