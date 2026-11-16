import { ValueObject } from '@nestjs-fastify-nx/core';

export class Email extends ValueObject<string> {
  private constructor(value: string) {
    super(value);
  }

  static fromPersistence(raw: string): Email {
    return new Email(raw);
  }

  override toString(): string {
    return this.value;
  }
}
