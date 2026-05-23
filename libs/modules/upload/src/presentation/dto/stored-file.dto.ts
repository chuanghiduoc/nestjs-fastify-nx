import { ApiProperty } from '@nestjs/swagger';
import type { StoredFile } from '@nestjs-fastify-nx/infra-storage';

export class StoredFileDto implements StoredFile {
  @ApiProperty({
    description: 'Storage key under which the file was persisted.',
    example: 'uploads/019dd1a5-9235-70db-8d57-54ef901d8185.png',
  })
  key!: string;

  @ApiProperty({
    description: 'Public URL of the stored file (presigned or CDN — depends on storage adapter).',
    example: 'https://cdn.example.com/uploads/019dd1a5-9235-70db-8d57-54ef901d8185.png',
    format: 'uri',
  })
  url!: string;

  @ApiProperty({ description: 'Storage bucket the file landed in.', example: 'app-uploads' })
  bucket!: string;

  @ApiProperty({ description: 'Size in bytes.', example: 12345 })
  size!: number;
}
