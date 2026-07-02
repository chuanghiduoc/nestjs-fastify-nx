import { Resolver, Query, Context, Args } from '@nestjs/graphql';
import { UseGuards, NotFoundException } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import {
  BetterAuthGuard,
  RolesGuard,
  Roles,
  type AuthenticatedSession,
} from '@nestjs-fastify-nx/infra-auth';
import { ListUsersCursorQuery, GetUserProfileQuery } from '@nestjs-fastify-nx/modules-users';
import { UserType } from '../types/user.type';
import { UserCursorPageType } from '../types/user-cursor-page.type';
import { ListUsersCursorArgs } from '../dto/list-users-cursor.args';

@Resolver(() => UserType)
export class UserResolver {
  constructor(private readonly queryBus: QueryBus) {}

  @Query(() => UserType, { name: 'me', nullable: true })
  @UseGuards(BetterAuthGuard)
  async me(@Context() context: { req: { user?: AuthenticatedSession } }): Promise<UserType | null> {
    const userId = context.req.user?.userId;
    if (!userId) return null;

    try {
      return await this.queryBus.execute(new GetUserProfileQuery(userId));
    } catch (err) {
      if (err instanceof NotFoundException) return null;
      throw err;
    }
  }

  @Query(() => UserCursorPageType, { name: 'users' })
  @UseGuards(BetterAuthGuard, RolesGuard)
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
