import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiCookieAuth } from '@nestjs/swagger';
import { UserProfileResponseDto } from '../dto/auth-response.dto';
import { GetUserProfileHandler } from '../../application/queries/get-user-profile/get-user-profile.handler';
import { GetUserProfileQuery } from '../../application/queries/get-user-profile/get-user-profile.query';
import { BetterAuthGuard, type AuthenticatedSession } from '@nestjs-fastify-nx/infra-auth';
import type { FastifyRequest } from 'fastify';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly getProfileHandler: GetUserProfileHandler) {}

  @Get('me')
  @UseGuards(BetterAuthGuard)
  @ApiCookieAuth('session')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, type: UserProfileResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getProfile(@Req() req: FastifyRequest & { user: AuthenticatedSession }) {
    return this.getProfileHandler.execute(new GetUserProfileQuery(req.user.userId));
  }
}
