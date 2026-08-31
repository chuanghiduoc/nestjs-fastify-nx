export { TermsModule } from './terms.module';

export { Term, TERM_TYPE, TERM_TYPES, type TermType } from './domain/entities/term.entity';
export {
  ListPublishedTermsQuery,
  type ListPublishedTermsResult,
} from './application/queries/list-published-terms/list-published-terms.query';
export { GetLatestTermQuery } from './application/queries/get-latest-term/get-latest-term.query';
export {
  ListMyTermAcceptancesQuery,
  type ListMyTermAcceptancesResult,
} from './application/queries/list-my-term-acceptances/list-my-term-acceptances.query';
export { CreateTermCommand } from './application/commands/create-term/create-term.command';
export { PublishTermCommand } from './application/commands/publish-term/publish-term.command';
export { AcceptTermCommand } from './application/commands/accept-term/accept-term.command';
export type { TermAcceptanceDto, TermDto } from './application/dto/term.dto';
export {
  CreateTermDto,
  TermAcceptanceResponseDto,
  TermResponseDto,
} from './presentation/dto/term.dto';
