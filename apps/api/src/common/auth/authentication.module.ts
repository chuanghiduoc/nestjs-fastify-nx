import { Module } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { BetterAuthModule, type AuthSessionPolicy } from '@nestjs-fastify-nx/infra-auth';
import {
  EnsurePersonalOrganizationCommand,
  OrganizationsModule,
} from '@nestjs-fastify-nx/modules-organizations';

@Module({
  imports: [
    OrganizationsModule,
    BetterAuthModule.forRoot({
      inject: [CommandBus],
      useFactory: (commands: CommandBus): AuthSessionPolicy => ({
        resolveOrganizationId: (userId) =>
          commands.execute(new EnsurePersonalOrganizationCommand(userId)),
      }),
    }),
  ],
})
export class AuthenticationModule {}
