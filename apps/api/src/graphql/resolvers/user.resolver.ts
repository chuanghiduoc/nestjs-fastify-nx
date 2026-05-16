import { Resolver, Query, Context, Args } from '@nestjs/graphql';
import { UseGuards, NotFoundException } from '@nestjs/common';
import {
  BetterAuthGuard,
  RolesGuard,
  Roles,
  type AuthenticatedSession,
} from '@nestjs-fastify-nx/infra-auth';
import {
  ListUsersHandler,
  ListUsersQuery,
  GetUserProfileHandler,
  GetUserProfileQuery,
} from '@nestjs-fastify-nx/modules-users';
import { UserType } from '../types/user.type';
import { UserPageType } from '../types/user-page.type';
import { ListUsersArgs } from '../dto/list-users.args';

@Resolver(() => UserType)
export class UserResolver {
  constructor(
    private readonly listUsersHandler: ListUsersHandler,
    private readonly getProfileHandler: GetUserProfileHandler,
  ) {}

  @Query(() => UserType, { name: 'me', nullable: true })
  @UseGuards(BetterAuthGuard)
  async me(@Context() context: { req: { user?: AuthenticatedSession } }): Promise<UserType | null> {
    const userId = context.req.user?.userId;
    if (!userId) return null;

    try {
      return await this.getProfileHandler.execute(new GetUserProfileQuery(userId));
    } catch (err) {
      if (err instanceof NotFoundException) return null;
      throw err;
    }
  }

  @Query(() => UserPageType, { name: 'users' })
  @UseGuards(BetterAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async users(@Args() args: ListUsersArgs): Promise<UserPageType> {
    const result = await this.listUsersHandler.execute(
      new ListUsersQuery(args.page, args.pageSize, args.role, args.status, args.search),
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
      meta: result.meta,
    };
  }
}
