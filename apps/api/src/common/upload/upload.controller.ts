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
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import '@fastify/multipart';
import { STORAGE_PORT, StoragePort, StoredFile } from '@nestjs-fastify-nx/infra-storage';
import { BetterAuthGuard } from '@nestjs-fastify-nx/infra-auth';
import { generateId } from '@nestjs-fastify-nx/shared';
import { ALLOWED_MIME_TYPES, detectFileType } from './file-signature';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

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
    summary:
      'Upload a file (max 10 MB; image/jpeg, image/png, image/gif, image/webp, application/pdf)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({ status: 201, description: 'File uploaded successfully' })
  @ApiResponse({ status: 400, description: 'Invalid file (size, mime, or content mismatch)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
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
