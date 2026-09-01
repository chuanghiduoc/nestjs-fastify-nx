import { Command } from '@nestjs/cqrs';
import type { IssuedApiKeyDto } from '../../dto/api-key.dto';

export interface CreateApiKeyInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly expiresAt?: Date;
}

export class CreateApiKeyCommand extends Command<IssuedApiKeyDto> {
  readonly organizationId: string;
  readonly userId: string;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly expiresAt?: Date;

  constructor(input: CreateApiKeyInput) {
    super();
    this.organizationId = input.organizationId;
    this.userId = input.userId;
    this.name = input.name;
    this.scopes = input.scopes;
    this.expiresAt = input.expiresAt;
  }
}
