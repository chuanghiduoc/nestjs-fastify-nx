import { Inject } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { TERM_REPOSITORY } from '../../../domain/ports/term-repository.port';
import type { TermRepositoryPort } from '../../../domain/ports/term-repository.port';
import type { TermDto } from '../../dto/term.dto';
import { termNotFound } from '../../term-errors';
import { GetLatestTermQuery } from './get-latest-term.query';

@QueryHandler(GetLatestTermQuery)
export class GetLatestTermHandler implements IQueryHandler<GetLatestTermQuery, TermDto> {
  constructor(@Inject(TERM_REPOSITORY) private readonly terms: TermRepositoryPort) {}

  async execute(query: GetLatestTermQuery): Promise<TermDto> {
    const term = await this.terms.findLatestPublished(query.type);
    if (!term) throw termNotFound();

    return {
      id: term.id,
      type: term.type,
      version: term.version,
      content: term.content,
      publishedAt: term.publishedAt,
      createdAt: term.createdAt,
    };
  }
}
