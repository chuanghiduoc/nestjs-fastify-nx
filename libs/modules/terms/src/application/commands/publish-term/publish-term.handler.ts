import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { TERM_REPOSITORY } from '../../../domain/ports/term-repository.port';
import type { TermRepositoryPort } from '../../../domain/ports/term-repository.port';
import type { Term } from '../../../domain/entities/term.entity';
import { toTermDto, type TermDto } from '../../dto/term.dto';
import { termNotFound } from '../../term-errors';
import { PublishTermCommand } from './publish-term.command';

@CommandHandler(PublishTermCommand)
export class PublishTermHandler implements ICommandHandler<PublishTermCommand, TermDto> {
  constructor(@Inject(TERM_REPOSITORY) private readonly terms: TermRepositoryPort) {}

  async execute(command: PublishTermCommand): Promise<TermDto> {
    const existing = await this.terms.findById(command.id);
    if (!existing) throw termNotFound();

    const published = await this.publishIfDraft(existing);

    return toTermDto(published);
  }

  private async publishIfDraft(existing: Term): Promise<Term> {
    if (existing.isPublished) return existing;

    const now = new Date();
    const candidate = existing.publishedAtOrNow(now);
    if (await this.terms.publish(candidate.id, now)) return candidate;

    const stored = await this.terms.findById(existing.id);
    if (!stored) throw termNotFound();
    return stored;
  }
}
