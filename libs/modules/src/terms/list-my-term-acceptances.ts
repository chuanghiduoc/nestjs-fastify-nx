import { Inject } from '@nestjs/common';
import { Query, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { TERM_REPOSITORY, type TermRepositoryPort } from './term-repository.port';
import type { TermAcceptanceDto } from './term.types';

export interface ListMyTermAcceptancesResult {
  data: TermAcceptanceDto[];
}

export class ListMyTermAcceptancesQuery extends Query<ListMyTermAcceptancesResult> {
  constructor(readonly userId: string) {
    super();
  }
}

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
