import type { Term, TermType } from '../entities/term.entity';

export const TERM_REPOSITORY = Symbol('TERM_REPOSITORY');

export interface TermAcceptanceRecord {
  readonly termId: string;
  readonly type: TermType;
  readonly version: string;
  readonly acceptedAt: Date;
}

export interface TermRepositoryPort {
  findPublished(): Promise<Term[]>;
  findLatestPublished(type: TermType): Promise<Term | null>;
  findById(id: string): Promise<Term | null>;
  create(term: Term): Promise<void>;
  publish(id: string, publishedAt: Date): Promise<boolean>;
  /** Idempotent: a repeated acceptance keeps the first timestamp. */
  recordAcceptance(input: {
    termId: string;
    userId: string;
    acceptedAt: Date;
    ipAddress: string | null;
  }): Promise<void>;
  findAcceptances(userId: string): Promise<TermAcceptanceRecord[]>;
}
