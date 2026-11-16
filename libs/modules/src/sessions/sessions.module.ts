import { Module } from '@nestjs/common';
import { DatabaseModule } from '@nestjs-fastify-nx/infra/database';
import { SESSION_REPOSITORY } from './session-repository.port';
import { PrismaSessionRepository } from './prisma-session.repository';
import { ListMySessionsHandler } from './list-my-sessions';
import { RevokeSessionHandler } from './revoke-session';
import { RevokeOtherSessionsHandler } from './revoke-other-sessions';
import { SessionsController } from './sessions.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [SessionsController],
  providers: [
    { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
    ListMySessionsHandler,
    RevokeSessionHandler,
    RevokeOtherSessionsHandler,
  ],
})
export class SessionsModule {}
