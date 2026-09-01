import { Query } from '@nestjs/cqrs';
import type { TermDto } from '../../dto/term.dto';

export interface ListPublishedTermsResult {
  data: TermDto[];
}

export class ListPublishedTermsQuery extends Query<ListPublishedTermsResult> {}
