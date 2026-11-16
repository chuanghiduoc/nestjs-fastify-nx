import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { TERM_REPOSITORY, type TermRepositoryPort } from './term-repository.port';
import { termNotFound, termNotPublished } from './term-errors';

export class AcceptTermCommand extends Command<void> {
  constructor(
    readonly userId: string,
    readonly termId: string,
    readonly ipAddress: string | null,
  ) {
    super();
  }
}

@CommandHandler(AcceptTermCommand)
export class AcceptTermHandler implements ICommandHandler<AcceptTermCommand, void> {
  constructor(@Inject(TERM_REPOSITORY) private readonly terms: TermRepositoryPort) {}

  async execute(command: AcceptTermCommand): Promise<void> {
    const term = await this.terms.findById(command.termId);
    if (!term) throw termNotFound();
    if (!term.isPublished) throw termNotPublished();

    await this.terms.recordAcceptance({
      termId: term.id,
      userId: command.userId,
      acceptedAt: new Date(),
      ipAddress: command.ipAddress,
    });
  }
}
