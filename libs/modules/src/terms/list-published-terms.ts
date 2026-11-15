import { Inject } from '@nestjs/common';
import { Query, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { TERM_REPOSITORY, type TermRepositoryPort } from './term-repository.port';
import { toTermDto, type TermDto } from './term.dto';

export interface ListPublishedTermsResult {
  data: TermDto[];
}

export class ListPublishedTermsQuery extends Query<ListPublishedTermsResult> {}

@QueryHandler(ListPublishedTermsQuery)
export class ListPublishedTermsHandler implements IQueryHandler<
  ListPublishedTermsQuery,
  ListPublishedTermsResult
> {
  constructor(@Inject(TERM_REPOSITORY) private readonly terms: TermRepositoryPort) {}

  async execute(): Promise<ListPublishedTermsResult> {
    const published = await this.terms.findPublished();

    const data: TermDto[] = published.map(toTermDto);

    return { data };
  }
}
