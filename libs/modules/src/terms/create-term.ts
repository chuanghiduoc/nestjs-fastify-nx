import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { TERM_REPOSITORY, type TermRepositoryPort } from './term-repository.port';
import { Term, type TermType } from './term.entity';
import { toTermDto, type TermDto } from './term.dto';

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

@CommandHandler(CreateTermCommand)
export class CreateTermHandler implements ICommandHandler<CreateTermCommand, TermDto> {
  constructor(@Inject(TERM_REPOSITORY) private readonly terms: TermRepositoryPort) {}

  async execute(command: CreateTermCommand): Promise<TermDto> {
    const term = Term.create({
      type: command.type,
      version: command.version,
      content: command.content,
      publishedAt: command.publish ? new Date() : null,
    });

    await this.terms.create(term);

    return toTermDto(term);
  }
}
