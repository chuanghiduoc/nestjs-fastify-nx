import { Resolver, Query, Context, Args } from '@nestjs/graphql';
import { HttpStatus } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { BusinessRuleException } from '@nestjs-fastify-nx/core';
import { Roles, type AuthenticatedSession } from '@nestjs-fastify-nx/infra-auth';
import { ListUsersCursorQuery, GetUserProfileQuery } from '@nestjs-fastify-nx/modules-users';
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
  async me(@Context() context: { req: { user?: AuthenticatedSession } }): Promise<UserType | null> {
    const userId = context.req.user?.userId;
    if (!userId) return null;

    try {
      return await this.queryBus.execute(new GetUserProfileQuery(userId));
    } catch (err) {
      // Session valid but the account was deleted — the handler raises a 404 BusinessRuleException;
      // `me` is nullable, so surface null instead of an error.
      if (err instanceof BusinessRuleException && err.getStatus() === HttpStatus.NOT_FOUND) {
        return null;
      }
      throw err;
    }
  }

  @Query(() => UserCursorPageType, { name: 'users' })
  @Roles('ADMIN')
  async users(@Args() args: ListUsersCursorArgs): Promise<UserCursorPageType> {
    const result = await this.queryBus.execute(
      new ListUsersCursorQuery(args.limit, args.startingAfter, args.role, args.status, args.search),
    );
    return {
      data: result.data.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        status: u.status,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      })),
      hasMore: result.hasMore,
      lastCursor: result.lastCursor,
    };
  }
}
