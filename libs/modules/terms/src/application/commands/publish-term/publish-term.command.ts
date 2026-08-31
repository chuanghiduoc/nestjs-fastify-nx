import { Command } from '@nestjs/cqrs';
import type { TermDto } from '../../dto/term.dto';

export class PublishTermCommand extends Command<TermDto> {
  constructor(readonly id: string) {
    super();
  }
}
