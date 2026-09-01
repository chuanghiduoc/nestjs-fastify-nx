import { Command } from '@nestjs/cqrs';
import type { TermType } from '../../../domain/entities/term.entity';
import type { TermDto } from '../../dto/term.dto';

export interface CreateTermInput {
  readonly type: TermType;
  readonly version: string;
  readonly content: string;
  readonly publish?: boolean;
}

export class CreateTermCommand extends Command<TermDto> {
  readonly type: TermType;
  readonly version: string;
  readonly content: string;
  readonly publish: boolean;

  constructor(input: CreateTermInput) {
    super();
    this.type = input.type;
    this.version = input.version;
    this.content = input.content;
    this.publish = input.publish ?? false;
  }
}
