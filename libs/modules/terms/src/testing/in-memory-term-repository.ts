import { Term, type TermType } from '../domain/entities/term.entity';
import type {
  TermAcceptanceRecord,
  TermRepositoryPort,
} from '../domain/ports/term-repository.port';

export class InMemoryTermRepository implements TermRepositoryPort {
  private readonly terms = new Map<string, Term>();
  private readonly acceptances = new Map<string, TermAcceptanceRecord & { userId: string }>();

  seed(term: Term): void {
    this.terms.set(term.id, term);
  }

  findPublished(): Promise<Term[]> {
    return Promise.resolve([...this.terms.values()].filter((term) => term.isPublished));
  }

  findLatestPublished(type: TermType): Promise<Term | null> {
    const published = [...this.terms.values()]
      .filter((term) => term.type === type && term.publishedAt !== null)
      .sort(
        (left, right) => (right.publishedAt?.getTime() ?? 0) - (left.publishedAt?.getTime() ?? 0),
      );
    return Promise.resolve(published[0] ?? null);
  }

  findById(id: string): Promise<Term | null> {
    return Promise.resolve(this.terms.get(id) ?? null);
  }

  create(term: Term): Promise<void> {
    this.seed(term);
    return Promise.resolve();
  }

  publish(id: string, publishedAt: Date): Promise<boolean> {
    const term = this.terms.get(id);
    if (!term || term.isPublished) return Promise.resolve(false);

    this.terms.set(
      id,
      Term.reconstitute({
        id: term.id,
        type: term.type,
        version: term.version,
        content: term.content,
        publishedAt,
        createdAt: term.createdAt,
        updatedAt: publishedAt,
      }),
    );
    return Promise.resolve(true);
  }

  recordAcceptance(input: {
    termId: string;
    userId: string;
    acceptedAt: Date;
    ipAddress: string | null;
  }): Promise<void> {
    const key = `${input.termId}::${input.userId}`;
    const term = this.terms.get(input.termId);
    if (this.acceptances.has(key) || !term) return Promise.resolve();

    this.acceptances.set(key, {
      termId: term.id,
      type: term.type,
      version: term.version,
      acceptedAt: input.acceptedAt,
      userId: input.userId,
    });
    return Promise.resolve();
  }

  findAcceptances(userId: string): Promise<TermAcceptanceRecord[]> {
    return Promise.resolve(
      [...this.acceptances.values()]
        .filter((acceptance) => acceptance.userId === userId)
        .map(({ termId, type, version, acceptedAt }) => ({ termId, type, version, acceptedAt })),
    );
  }
}
