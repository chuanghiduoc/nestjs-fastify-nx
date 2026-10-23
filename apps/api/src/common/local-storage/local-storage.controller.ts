import '@fastify/multipart';
import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '@nestjs-fastify-nx/infra-auth';
import {
  LOCAL_STORAGE_CONTROLLER_PATH,
  LOCAL_STORAGE_DOWNLOAD_ROUTE,
  LOCAL_STORAGE_UPLOAD_ROUTE,
  STORAGE_PORT,
  requireLocalStorage,
  type LocalStorageAdapter,
  type StoragePort,
} from '@nestjs-fastify-nx/infra-storage';
import type { EnvConfig } from '../../config/env.validation';
import { LocalDownloadQueryDto } from './local-download-query.dto';

const FILE_FIELD = 'file';
const MAX_FORM_FIELDS = 16;
const UPLOAD_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@ApiExcludeController()
@Public()
@Controller(LOCAL_STORAGE_CONTROLLER_PATH)
export class LocalStorageController {
  private readonly storage: LocalStorageAdapter;
  private readonly partLimits: Record<'fileSize' | 'files' | 'fields' | 'parts', number>;

  constructor(@Inject(STORAGE_PORT) storage: StoragePort, config: ConfigService<EnvConfig, true>) {
    this.storage = requireLocalStorage(storage);
    this.partLimits = {
      fileSize: config.get('UPLOAD_MAX_FILE_BYTES', { infer: true }) + 1,
      files: Number.MAX_SAFE_INTEGER,
      fields: Number.MAX_SAFE_INTEGER,
      parts: Number.MAX_SAFE_INTEGER,
    };
  }

  @Post(LOCAL_STORAGE_UPLOAD_ROUTE)
  @Throttle(UPLOAD_LIMIT)
  @HttpCode(HttpStatus.NO_CONTENT)
  async upload(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    try {
      await this.receive(request);
    } catch (err) {
      reply.header('connection', 'close');
      throw err;
    }
  }

  private async receive(request: FastifyRequest): Promise<void> {
    if (!request.isMultipart()) throw new BadRequestException('Expected multipart/form-data.');
    const fields: Record<string, string> = {};
    let fieldCount = 0;
    for await (const part of request.parts({ limits: this.partLimits })) {
      if (part.type === 'field') {
        fieldCount += 1;
        if (fieldCount > MAX_FORM_FIELDS || typeof part.value !== 'string') {
          throw new BadRequestException('Unexpected form field.');
        }
        fields[part.fieldname] = part.value;
        continue;
      }
      if (part.fieldname !== FILE_FIELD) {
        throw new BadRequestException('Only a file field named file is accepted.');
      }
      await this.storage.acceptPresignedUpload(fields, part.file);
      return;
    }
    throw new BadRequestException('A file field named file is required.');
  }

  @Get(LOCAL_STORAGE_DOWNLOAD_ROUTE)
  async download(@Query() query: LocalDownloadQueryDto, @Res() reply: FastifyReply): Promise<void> {
    const download = await this.storage.openSignedDownload(query);
    if (!download) throw new NotFoundException();
    await reply
      .header('content-type', download.contentType)
      .header('content-length', String(download.size))
      .header('content-disposition', 'attachment')
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, no-store')
      .send(download.stream);
  }
}
