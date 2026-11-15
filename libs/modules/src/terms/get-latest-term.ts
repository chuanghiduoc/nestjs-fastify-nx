import { Inject } from '@nestjs/common';
import { Query, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { TERM_REPOSITORY, type TermRepositoryPort } from './term-repository.port';
import type { TermType } from './term.entity';
import { toTermDto, type TermDto } from './term.dto';
import { termNotFound } from './term-errors';

export class GetLatestTermQuery extends Query<TermDto> {
  constructor(readonly type: TermType) {
    super();
  }
}

@QueryHandler(GetLatestTermQuery)
export class GetLatestTermHandler implements IQueryHandler<GetLatestTermQuery, TermDto> {
  constructor(@Inject(TERM_REPOSITORY) private readonly terms: TermRepositoryPort) {}

  async execute(query: GetLatestTermQuery): Promise<TermDto> {
    const term = await this.terms.findLatestPublished(query.type);
    if (!term) throw termNotFound();

    return toTermDto(term);
  }
}
