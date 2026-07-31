import { z } from 'zod';
import { ValueObject } from '@nestjs-fastify-nx/core';

export class Email extends ValueObject<string> {
  private static readonly SCHEMA = z.email();

  private constructor(value: string) {
    super(value);
  }

  static create(raw: string): Email {
    const normalized = raw.trim().toLowerCase();
    if (!Email.SCHEMA.safeParse(normalized).success) {
      throw new Error('Invalid email address');
    }
    return new Email(normalized);
  }

  static fromPersistence(raw: string): Email {
    return new Email(raw);
  }

  override toString(): string {
    return this.value;
  }
}
