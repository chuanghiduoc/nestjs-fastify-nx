import { Query } from '@nestjs/cqrs';
import type { TermType } from '../../../domain/entities/term.entity';
import type { TermDto } from '../../dto/term.dto';

export class GetLatestTermQuery extends Query<TermDto> {
  constructor(readonly type: TermType) {
    super();
  }
}
