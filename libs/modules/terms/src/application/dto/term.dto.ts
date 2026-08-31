import type { TermType } from '../../domain/entities/term.entity';

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
