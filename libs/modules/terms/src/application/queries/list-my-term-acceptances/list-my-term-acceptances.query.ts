import { Query } from '@nestjs/cqrs';
import type { TermAcceptanceDto } from '../../dto/term.dto';

export interface ListMyTermAcceptancesResult {
  data: TermAcceptanceDto[];
}

export class ListMyTermAcceptancesQuery extends Query<ListMyTermAcceptancesResult> {
  constructor(readonly userId: string) {
    super();
  }
}
