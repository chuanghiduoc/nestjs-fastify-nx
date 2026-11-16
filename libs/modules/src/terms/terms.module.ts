import { Module } from '@nestjs/common';
import { DatabaseModule } from '@nestjs-fastify-nx/infra/database';
import { TERM_REPOSITORY } from './term-repository.port';
import { PrismaTermRepository } from './prisma-term.repository';
import { ListPublishedTermsHandler } from './list-published-terms';
import { GetLatestTermHandler } from './get-latest-term';
import { ListMyTermAcceptancesHandler } from './list-my-term-acceptances';
import { CreateTermHandler } from './create-term';
import { PublishTermHandler } from './publish-term';
import { AcceptTermHandler } from './accept-term';
import { TermsController } from './terms.controller';

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
