import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import { ALLOWED_MIME_TYPES } from '@nestjs-fastify-nx/shared';

const ALLOWED_MIME_LIST = Array.from(ALLOWED_MIME_TYPES);

export class PresignUploadDto {
  @ApiProperty({
    description: 'Declared MIME type of the file the client intends to upload.',
    enum: ALLOWED_MIME_LIST,
    example: 'image/png',
  })
  @IsString()
  @IsIn(ALLOWED_MIME_LIST)
  contentType!: string;
}
