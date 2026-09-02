import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { TERM_REPOSITORY } from '../../../domain/ports/term-repository.port';
import type { TermRepositoryPort } from '../../../domain/ports/term-repository.port';
import type { Term } from '../../../domain/entities/term.entity';
import type { TermDto } from '../../dto/term.dto';
import { termNotFound } from '../../term-errors';
import { PublishTermCommand } from './publish-term.command';

@CommandHandler(PublishTermCommand)
export class PublishTermHandler implements ICommandHandler<PublishTermCommand, TermDto> {
  constructor(@Inject(TERM_REPOSITORY) private readonly terms: TermRepositoryPort) {}

  async execute(command: PublishTermCommand): Promise<TermDto> {
    const existing = await this.terms.findById(command.id);
    if (!existing) throw termNotFound();

    const published = await this.publishIfDraft(existing);

    return {
      id: published.id,
      type: published.type,
      version: published.version,
      content: published.content,
      publishedAt: published.publishedAt,
      createdAt: published.createdAt,
    };
  }

  private async publishIfDraft(existing: Term): Promise<Term> {
    if (existing.isPublished) return existing;

    const candidate = existing.publishedAtOrNow();
    const publishedAt = candidate.publishedAt;
    if (publishedAt && (await this.terms.publish(candidate.id, publishedAt))) return candidate;

    const stored = await this.terms.findById(existing.id);
    if (!stored) throw termNotFound();
    return stored;
  }
}
