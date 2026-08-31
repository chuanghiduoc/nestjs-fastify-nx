import { Inject } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { TERM_REPOSITORY } from '../../../domain/ports/term-repository.port';
import type { TermRepositoryPort } from '../../../domain/ports/term-repository.port';
import type { TermDto } from '../../dto/term.dto';
import {
  ListPublishedTermsQuery,
  type ListPublishedTermsResult,
} from './list-published-terms.query';

@QueryHandler(ListPublishedTermsQuery)
export class ListPublishedTermsHandler implements IQueryHandler<
  ListPublishedTermsQuery,
  ListPublishedTermsResult
> {
  constructor(@Inject(TERM_REPOSITORY) private readonly terms: TermRepositoryPort) {}

  async execute(): Promise<ListPublishedTermsResult> {
    const published = await this.terms.findPublished();

    const data: TermDto[] = published.map((term) => ({
      id: term.id,
      type: term.type,
      version: term.version,
      content: term.content,
      publishedAt: term.publishedAt,
      createdAt: term.createdAt,
    }));

    return { data };
  }
}
