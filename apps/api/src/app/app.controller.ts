import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@nestjs-fastify-nx/infra-auth';

@ApiTags('app')
@Public()
@Controller()
export class AppController {
  @Get()
  @ApiOperation({ summary: 'API version info' })
  @ApiResponse({ status: 200, description: 'Returns service name and version' })
  root() {
    return { name: 'nestjs-fastify-nx', version: '1.0.0' };
  }
}
