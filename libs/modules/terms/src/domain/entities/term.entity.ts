import { DomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS } from '@nestjs-fastify-nx/contracts';
import { generateId } from '@nestjs-fastify-nx/shared';

export const TERM_TYPE = {
  TERMS_OF_SERVICE: 'terms_of_service',
  PRIVACY_POLICY: 'privacy_policy',
  COOKIE_POLICY: 'cookie_policy',
} as const;

export const TERM_TYPES = Object.values(TERM_TYPE);

export type TermType = (typeof TERM_TYPE)[keyof typeof TERM_TYPE];

const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,49}$/;

export interface TermProps {
  id: string;
  type: TermType;
  version: string;
  content: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTermInput {
  id?: string;
  type: TermType;
  version: string;
  content: string;
  publishedAt?: Date | null;
}

function assertVersion(version: string): string {
  if (VERSION_PATTERN.test(version)) return version;

  throw new DomainException({
    kind: 'validation',
    code: ERROR_CODES.VALIDATION_FAILED,
    title: I18N_KEYS.common.unprocessable_entity,
    violations: [
      {
        path: 'version',
        code: 'invalid_version',
        message:
          'version must be 1-50 characters of letters, digits, dot, hyphen or underscore, starting with a letter or digit',
      },
    ],
  });
}

export class Term {
  private constructor(private readonly props: TermProps) {}

  static create(input: CreateTermInput): Term {
    const now = new Date();
    return new Term({
      id: input.id ?? generateId(),
      type: input.type,
      version: assertVersion(input.version),
      content: input.content,
      publishedAt: input.publishedAt ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(raw: TermProps): Term {
    return new Term(raw);
  }

  publishedAtOrNow(now: Date = new Date()): Term {
    // Publishing twice keeps the first date: the moment a document became binding is a legal fact,
    // not something a repeated call may move.
    if (this.props.publishedAt !== null) return this;
    return new Term({ ...this.props, publishedAt: now, updatedAt: now });
  }

  get isPublished(): boolean {
    return this.props.publishedAt !== null;
  }

  get id(): string {
    return this.props.id;
  }
  get type(): TermType {
    return this.props.type;
  }
  get version(): string {
    return this.props.version;
  }
  get content(): string {
    return this.props.content;
  }
  get publishedAt(): Date | null {
    return this.props.publishedAt;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
