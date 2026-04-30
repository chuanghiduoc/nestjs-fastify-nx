import { ValueObject } from '@nestjs-fastify-nx/core';

export class Email extends ValueObject<string> {
  private static readonly REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  private constructor(value: string) {
    super(value);
  }

  static create(raw: string): Email {
    const normalized = raw.trim().toLowerCase();
    if (!Email.REGEX.test(normalized)) {
      throw new Error(`Invalid email: ${raw}`);
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
