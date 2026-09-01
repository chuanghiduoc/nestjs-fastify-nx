import type {
  FindSessionsCursorOptions,
  FindSessionsCursorResult,
  SessionRecord,
  SessionRepositoryPort,
} from '../domain/ports/session-repository.port';

export class InMemorySessionRepository implements SessionRepositoryPort {
  private readonly sessions = new Map<string, SessionRecord>();

  seed(session: SessionRecord): void {
    this.sessions.set(session.id, session);
  }

  findAllCursor(options: FindSessionsCursorOptions): Promise<FindSessionsCursorResult> {
    const matching = [...this.sessions.values()]
      .filter((session) => session.userId === options.userId)
      .filter((session) =>
        options.activeOnly ? session.expiresAt.getTime() > options.now.getTime() : true,
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

    return Promise.resolve({
      items: matching.slice(0, options.limit),
      hasMore: matching.length > options.limit,
    });
  }

  findByIdForUser(userId: string, id: string): Promise<SessionRecord | null> {
    const session = this.sessions.get(id);
    return Promise.resolve(session && session.userId === userId ? session : null);
  }

  deleteForUser(userId: string, id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session || session.userId !== userId) return Promise.resolve(false);
    return Promise.resolve(this.sessions.delete(id));
  }

  deleteAllForUserExcept(userId: string, keepSessionId: string): Promise<number> {
    let removed = 0;
    for (const session of [...this.sessions.values()]) {
      if (session.userId !== userId || session.id === keepSessionId) continue;
      this.sessions.delete(session.id);
      removed += 1;
    }
    return Promise.resolve(removed);
  }

  size(): number {
    return this.sessions.size;
  }
}
