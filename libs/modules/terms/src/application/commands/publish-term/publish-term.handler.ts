import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { TERM_REPOSITORY } from '../../../domain/ports/term-repository.port';
import type { TermRepositoryPort } from '../../../domain/ports/term-repository.port';
import type { TermDto } from '../../dto/term.dto';
import { termNotFound } from '../../term-errors';
import { PublishTermCommand } from './publish-term.command';

@CommandHandler(PublishTermCommand)
export class PublishTermHandler implements ICommandHandler<PublishTermCommand, TermDto> {
  constructor(@Inject(TERM_REPOSITORY) private readonly terms: TermRepositoryPort) {}

  async execute(command: PublishTermCommand): Promise<TermDto> {
    const existing = await this.terms.findById(command.id);
    if (!existing) throw termNotFound();

    const published = existing.publishedAtOrNow();
    if (!existing.isPublished && published.publishedAt) {
      await this.terms.publish(published.id, published.publishedAt);
    }

    return {
      id: published.id,
      type: published.type,
      version: published.version,
      content: published.content,
      publishedAt: published.publishedAt,
      createdAt: published.createdAt,
    };
  }
}
