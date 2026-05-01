import { Resolver, Query, Context, Args } from '@nestjs/graphql';
import { Inject, UseGuards } from '@nestjs/common';
import {
  BetterAuthGuard,
  RolesGuard,
  Roles,
  type AuthenticatedSession,
} from '@nestjs-fastify-nx/infra-auth';
import {
  USER_REPOSITORY_PORT,
  UserRepositoryPort,
  ListUsersHandler,
  ListUsersQuery,
} from '@nestjs-fastify-nx/modules-users';
import { UserType } from '../types/user.type';
import { UserPageType } from '../types/user-page.type';
import { ListUsersArgs } from '../dto/list-users.args';

@Resolver(() => UserType)
export class UserResolver {
  constructor(
    @Inject(USER_REPOSITORY_PORT)
    private readonly userRepository: UserRepositoryPort,
    private readonly listUsersHandler: ListUsersHandler,
  ) {}

  @Query(() => UserType, { name: 'me', nullable: true })
  @UseGuards(BetterAuthGuard)
  async me(@Context() context: { req: { user?: AuthenticatedSession } }): Promise<UserType | null> {
    const userId = context.req.user?.userId;
    if (!userId) return null;

    const user = await this.userRepository.findById(userId);
    if (!user) return null;

    return {
      id: user.id,
      email: user.email.toString(),
      name: user.name,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
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
