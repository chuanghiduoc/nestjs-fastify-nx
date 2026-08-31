import { Command } from '@nestjs/cqrs';
import type { RevokedSessionsDto } from '../../dto/session.dto';

export class RevokeOtherSessionsCommand extends Command<RevokedSessionsDto> {
  constructor(
    readonly userId: string,
    readonly currentSessionId: string,
  ) {
    super();
  }
}
