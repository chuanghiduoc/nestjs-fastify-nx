import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiCookieAuth } from '@nestjs/swagger';
import { ApiCommonErrors } from '@nestjs-fastify-nx/contracts';
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
  @ApiOperation({
    summary: 'Get the authenticated user profile',
    description:
      'Returns the profile of the user owning the session cookie. Use after sign-in to populate `currentUser` in the SPA.',
  })
  @ApiOkResponse({ type: UserProfileResponseDto, description: 'The current user profile.' })
  @ApiCommonErrors({ auth: true, forbidden: false, validation: false })
  getProfile(
    @Req() req: FastifyRequest & { user: AuthenticatedSession },
  ): Promise<UserProfileResponseDto> {
    return this.getProfileHandler.execute(new GetUserProfileQuery(req.user.userId));
  }
}
