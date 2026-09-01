export { SessionsModule } from './sessions.module';

export {
  ListMySessionsQuery,
  type ListMySessionsResult,
} from './application/queries/list-my-sessions/list-my-sessions.query';
export { RevokeSessionCommand } from './application/commands/revoke-session/revoke-session.command';
export { RevokeOtherSessionsCommand } from './application/commands/revoke-other-sessions/revoke-other-sessions.command';
export type { RevokedSessionsDto, SessionDto } from './application/dto/session.dto';
export {
  ListSessionsFilterDto,
  RevokedSessionsResponseDto,
  SessionResponseDto,
} from './presentation/dto/session.dto';
