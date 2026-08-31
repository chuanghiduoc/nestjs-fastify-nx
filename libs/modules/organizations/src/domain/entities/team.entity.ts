import { DomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS } from '@nestjs-fastify-nx/contracts';
import { generateId } from '@nestjs-fastify-nx/shared';

const NAME_MIN_LENGTH = 1;
const NAME_MAX_LENGTH = 100;

export interface TeamProps {
  id: string;
  organizationId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface CreateTeamInput {
  id?: string;
  organizationId: string;
  name: string;
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < NAME_MIN_LENGTH || trimmed.length > NAME_MAX_LENGTH) {
    throw new DomainException({
      kind: 'validation',
      code: ERROR_CODES.VALIDATION_FAILED,
      title: I18N_KEYS.common.unprocessable_entity,
      violations: [
        {
          path: 'name',
          code: 'invalid_length',
          message: `name must be between ${NAME_MIN_LENGTH} and ${NAME_MAX_LENGTH} characters after trimming`,
        },
      ],
    });
  }
  return trimmed;
}

export class Team {
  private constructor(private readonly props: TeamProps) {}

  static create(input: CreateTeamInput): Team {
    return new Team({
      id: input.id ?? generateId(),
      organizationId: input.organizationId,
      name: normalizeName(input.name),
      createdAt: new Date(),
      updatedAt: null,
    });
  }

  static reconstitute(raw: TeamProps): Team {
    return new Team(raw);
  }

  renamedTo(name: string): Team {
    return new Team({ ...this.props, name: normalizeName(name), updatedAt: new Date() });
  }

  get id(): string {
    return this.props.id;
  }
  get organizationId(): string {
    return this.props.organizationId;
  }
  get name(): string {
    return this.props.name;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date | null {
    return this.props.updatedAt;
  }
}
