import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { TERM_REPOSITORY } from '../../../domain/ports/term-repository.port';
import type { TermRepositoryPort } from '../../../domain/ports/term-repository.port';
import { Term } from '../../../domain/entities/term.entity';
import type { TermDto } from '../../dto/term.dto';
import { CreateTermCommand } from './create-term.command';

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
