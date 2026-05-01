import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { ApiCommonErrors } from '@nestjs-fastify-nx/contracts';
import type { FastifyRequest } from 'fastify';
import '@fastify/multipart';
import { STORAGE_PORT, StoragePort, StoredFile } from '@nestjs-fastify-nx/infra-storage';
import { BetterAuthGuard } from '@nestjs-fastify-nx/infra-auth';
import { generateId } from '@nestjs-fastify-nx/shared';
import { ALLOWED_MIME_TYPES, detectFileType } from './file-signature';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

class UploadResponseDto implements StoredFile {
  @ApiProperty({
    description: 'Storage key under which the file was persisted (use to build a download URL).',
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

@ApiTags('upload')
@Controller('upload')
export class UploadController {
  constructor(@Inject(STORAGE_PORT) private readonly storage: StoragePort) {}

  @Post()
  @UseGuards(BetterAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiCookieAuth('session')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a file (max 10 MB).',
    description:
      'Accepts a single `file` part. Allowed MIME types: `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `application/pdf`. The declared `Content-Type` is verified against the file content (magic-byte sniff) — mismatched types are rejected with 400.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({ type: UploadResponseDto, description: 'File uploaded successfully.' })
  @ApiCommonErrors({
    auth: true,
    forbidden: false,
    validation: false,
    unsupportedMediaType: true,
    payloadTooLarge: true,
  })
  async uploadFile(@Req() req: FastifyRequest): Promise<StoredFile> {
    if (!req.isMultipart()) {
      throw new BadRequestException('Request must be multipart/form-data');
    }

    const file = await req.file({ limits: { fileSize: MAX_FILE_SIZE } });
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(`Mime type "${file.mimetype}" is not allowed`);
    }

    const chunks: Buffer[] = [];
    for await (const chunk of file.file) {
      chunks.push(chunk as Buffer);
    }

    if (file.file.truncated) {
      throw new BadRequestException(`File exceeds ${MAX_FILE_SIZE / (1024 * 1024)} MB limit`);
    }

    const body = Buffer.concat(chunks);
    if (body.length === 0) {
      throw new BadRequestException('Empty file');
    }

    const detected = detectFileType(body);
    if (!detected) {
      throw new BadRequestException('Unrecognised file content');
    }
    if (detected.mimeType !== file.mimetype) {
      throw new BadRequestException(
        `Declared mime type "${file.mimetype}" does not match content "${detected.mimeType}"`,
      );
    }

    const key = `uploads/${generateId()}.${detected.extension}`;

    return this.storage.upload(key, body, { contentType: detected.mimeType });
  }
}
