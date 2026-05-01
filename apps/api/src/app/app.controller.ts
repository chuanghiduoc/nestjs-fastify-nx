import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ApiCommonErrors } from '@nestjs-fastify-nx/contracts';
import { Public } from '@nestjs-fastify-nx/infra-auth';

class ServiceInfoDto {
  @ApiProperty({ description: 'Service identifier.', example: 'nestjs-fastify-nx' })
  name!: string;

  @ApiProperty({ description: 'Semantic version of the running build.', example: '1.0.0' })
  version!: string;
}

@ApiTags('app')
@Public()
@Controller()
export class AppController {
  @Get()
  @ApiOperation({ summary: 'Service metadata (name + version).' })
  @ApiOkResponse({ type: ServiceInfoDto, description: 'Service identification.' })
  @ApiCommonErrors({ auth: false, forbidden: false, validation: false })
  root(): ServiceInfoDto {
    return { name: 'nestjs-fastify-nx', version: '1.0.0' };
  }
}
