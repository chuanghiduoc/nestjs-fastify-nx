import { Module } from '@nestjs/common';
import { DatabaseModule } from '@nestjs-fastify-nx/infra-database';
import { SESSION_REPOSITORY } from './domain/ports/session-repository.port';
import { PrismaSessionRepository } from './infrastructure/repositories/prisma-session.repository';
import { ListMySessionsHandler } from './application/queries/list-my-sessions/list-my-sessions.handler';
import { RevokeSessionHandler } from './application/commands/revoke-session/revoke-session.handler';
import { RevokeOtherSessionsHandler } from './application/commands/revoke-other-sessions/revoke-other-sessions.handler';
import { SessionsController } from './presentation/controllers/sessions.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [SessionsController],
  providers: [
    { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
    ListMySessionsHandler,
    RevokeSessionHandler,
    RevokeOtherSessionsHandler,
  ],
  exports: [SESSION_REPOSITORY],
})
export class SessionsModule {}
