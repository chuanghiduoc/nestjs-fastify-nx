import { Inject } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { TERM_REPOSITORY } from '../../../domain/ports/term-repository.port';
import type { TermRepositoryPort } from '../../../domain/ports/term-repository.port';
import {
  ListMyTermAcceptancesQuery,
  type ListMyTermAcceptancesResult,
} from './list-my-term-acceptances.query';

@QueryHandler(ListMyTermAcceptancesQuery)
export class ListMyTermAcceptancesHandler implements IQueryHandler<
  ListMyTermAcceptancesQuery,
  ListMyTermAcceptancesResult
> {
  constructor(@Inject(TERM_REPOSITORY) private readonly terms: TermRepositoryPort) {}

  async execute(query: ListMyTermAcceptancesQuery): Promise<ListMyTermAcceptancesResult> {
    const acceptances = await this.terms.findAcceptances(query.userId);
    return {
      data: acceptances.map((acceptance) => ({
        termId: acceptance.termId,
        type: acceptance.type,
        version: acceptance.version,
        acceptedAt: acceptance.acceptedAt,
      })),
    };
  }
}
