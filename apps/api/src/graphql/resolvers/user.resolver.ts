import { Resolver, Query, Args } from '@nestjs/graphql';
import { QueryBus } from '@nestjs/cqrs';
import { isDomainException } from '@nestjs-fastify-nx/core';
import {
  CurrentUser,
  requireOrganizationId,
  type AuthenticatedSession,
} from '@nestjs-fastify-nx/infra-auth';
import { RequirePermission } from '@nestjs-fastify-nx/infra-authorization';
import { PERMISSIONS } from '@nestjs-fastify-nx/shared';
import { ListUsersCursorQuery, GetUserProfileQuery } from '@nestjs-fastify-nx/modules/users';
import { UserType } from '../types/user.type';
import { UserCursorPageType } from '../types/user-cursor-page.type';
import { ListUsersCursorArgs } from '../dto/list-users-cursor.args';

@Resolver(() => UserType)
export class UserResolver {
  constructor(private readonly queryBus: QueryBus) {}

  // Auth-required, mirroring REST `GET /users/me`: the global BetterAuthGuard resolves the session and
  // populates `req.user` before this runs, so an unauthenticated request fails with 401 and never
  // reaches here (marking it @Public would skip the guard and leave req.user unset — `me` would then
  // return null even for signed-in users). `nullable` exists ONLY for the deleted-account race handled
  // in the catch below; the `!userId` guard is defensive against the optional context type.
  @Query(() => UserType, { name: 'me', nullable: true })
  async me(@CurrentUser() user: AuthenticatedSession): Promise<UserType | null> {
    const userId = user.userId;

    try {
      return await this.queryBus.execute(new GetUserProfileQuery(userId));
    } catch (err) {
      // Session valid but the account was deleted. `me` is nullable, so surface null instead of an
      // error — matched on the domain kind, not an HTTP status this transport does not own.
      if (isDomainException(err) && err.kind === 'not_found') {
        return null;
      }
      throw err;
    }
  }

  @Query(() => UserCursorPageType, { name: 'users' })
  @RequirePermission(PERMISSIONS.MEMBER_READ)
  async users(
    @CurrentUser() user: AuthenticatedSession,
    @Args() args: ListUsersCursorArgs,
  ): Promise<UserCursorPageType> {
    const result = await this.queryBus.execute(
      new ListUsersCursorQuery(requireOrganizationId(user), args.limit, {
        startingAfter: args.startingAfter,
        role: args.role,
        status: args.status,
        search: args.search,
      }),
    );
    return {
      data: result.data,
      hasMore: result.hasMore,
      lastCursor: result.lastCursor,
    };
  }
}
