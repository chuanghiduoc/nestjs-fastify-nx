import type { Term, TermType } from '../../domain/entities/term.entity';

export interface TermDto {
  id: string;
  type: TermType;
  version: string;
  content: string;
  publishedAt: Date | null;
  createdAt: Date;
}

export interface TermAcceptanceDto {
  termId: string;
  type: TermType;
  version: string;
  acceptedAt: Date;
}

export function toTermDto(term: Term): TermDto {
  return {
    id: term.id,
    type: term.type,
    version: term.version,
    content: term.content,
    publishedAt: term.publishedAt,
    createdAt: term.createdAt,
  };
}
