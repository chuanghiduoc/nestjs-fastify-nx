import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ApiCommonErrors } from '@nestjs-fastify-nx/contracts';
import { Public } from '@nestjs-fastify-nx/infra-auth';
import type { EnvConfig } from '../config/env.validation';

class ServiceInfoDto {
  @ApiProperty({ description: 'Service identifier.', example: 'nestjs-fastify-nx' })
  name!: string;

  @ApiProperty({ description: 'Semantic version of the running build.', example: '1.2.0' })
  version!: string;
}

@ApiTags('app')
@Public()
@Controller()
export class AppController {
  constructor(private readonly config: ConfigService<EnvConfig, true>) {}

  @Get()
  @ApiOperation({ summary: 'Service metadata (name + version).' })
  @ApiOkResponse({ type: ServiceInfoDto, description: 'Service identification.' })
  @ApiCommonErrors({ auth: false, forbidden: false, validation: false })
  root(): ServiceInfoDto {
    return {
      name: this.config.get('APP_NAME', { infer: true }),
      version: this.config.get('APP_VERSION', { infer: true }),
    };
  }
}
