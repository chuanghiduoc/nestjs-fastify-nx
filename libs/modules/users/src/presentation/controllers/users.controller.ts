import { Controller, Get } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { ApiTags, ApiOperation, ApiOkResponse, ApiCookieAuth } from '@nestjs/swagger';
import { ApiCommonErrors } from '@nestjs-fastify-nx/contracts';
import { CurrentUser, type AuthenticatedSession } from '@nestjs-fastify-nx/infra-auth';
import { UserProfileResponseDto } from '../dto/auth-response.dto';
import { GetUserProfileQuery } from '../../application/queries/get-user-profile/get-user-profile.query';

@ApiTags('users')
@Controller('users')
@ApiCookieAuth('session')
export class UsersController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('me')
  @ApiOperation({
    summary: 'Get the authenticated user profile',
    description:
      'Returns the profile of the user owning the session cookie. Use after sign-in to populate `currentUser` in the SPA.',
  })
  @ApiOkResponse({ type: UserProfileResponseDto, description: 'The current user profile.' })
  // 404: the session is valid but the account was hard-deleted mid-session — the handler raises a
  // NOT_FOUND BusinessRuleException that propagates to the client here (GraphQL `me` maps it to null).
  @ApiCommonErrors({ auth: true, validation: false, notFound: true })
  getProfile(@CurrentUser() user: AuthenticatedSession): Promise<UserProfileResponseDto> {
    return this.queryBus.execute(new GetUserProfileQuery(user.userId));
  }
}
