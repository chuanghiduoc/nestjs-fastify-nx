import { Module } from '@nestjs/common';
import { DatabaseModule } from '@nestjs-fastify-nx/infra-database';
import { TERM_REPOSITORY } from './domain/ports/term-repository.port';
import { PrismaTermRepository } from './infrastructure/repositories/prisma-term.repository';
import { ListPublishedTermsHandler } from './application/queries/list-published-terms/list-published-terms.handler';
import { GetLatestTermHandler } from './application/queries/get-latest-term/get-latest-term.handler';
import { ListMyTermAcceptancesHandler } from './application/queries/list-my-term-acceptances/list-my-term-acceptances.handler';
import { CreateTermHandler } from './application/commands/create-term/create-term.handler';
import { PublishTermHandler } from './application/commands/publish-term/publish-term.handler';
import { AcceptTermHandler } from './application/commands/accept-term/accept-term.handler';
import { TermsController } from './presentation/controllers/terms.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [TermsController],
  providers: [
    { provide: TERM_REPOSITORY, useClass: PrismaTermRepository },
    ListPublishedTermsHandler,
    GetLatestTermHandler,
    ListMyTermAcceptancesHandler,
    CreateTermHandler,
    PublishTermHandler,
    AcceptTermHandler,
  ],
  exports: [TERM_REPOSITORY],
})
export class TermsModule {}
