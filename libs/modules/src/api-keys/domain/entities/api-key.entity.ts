import { DomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS, fieldProblem } from '@nestjs-fastify-nx/contracts';
import {
  ALL_PERMISSIONS,
  generateApiKey,
  generateId,
  type GeneratedApiKey,
  type Permission,
} from '@nestjs-fastify-nx/shared';

export interface ApiKeyProps {
  id: string;
  organizationId: string;
  name: string;
  prefix: string;
  keyHash: string;
  scopes: readonly Permission[];
  createdById: string | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IssueApiKeyInput {
  organizationId: string;
  name: string;
  scopes: readonly string[];
  createdById: string | null;
  expiresAt?: Date | null;
  /** Permissions the issuing caller holds; a key may never exceed them. */
  grantedToIssuer: readonly Permission[];
}

export interface IssuedApiKey {
  readonly entity: ApiKey;
  readonly raw: string;
}

function validation(path: string, code: string, message: string, messageKey: string): never {
  throw new DomainException(fieldProblem({ kind: 'validation', code, messageKey, path, message }));
}

function assertNonEmptyName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    validation(
      'name',
      ERROR_CODES.VALIDATION_FAILED,
      'name must not be empty',
      I18N_KEYS.validation.too_short,
    );
  }
  return trimmed;
}

function assertScopes(
  scopes: readonly string[],
  grantedToIssuer: readonly Permission[],
): readonly Permission[] {
  if (scopes.length === 0) {
    validation(
      'scopes',
      ERROR_CODES.VALIDATION_FAILED,
      'an API key must carry at least one scope',
      I18N_KEYS.errors.api_keys.empty_scopes,
    );
  }

  const catalog = new Set<string>(ALL_PERMISSIONS);
  const unknown = scopes.filter((scope) => !catalog.has(scope));
  if (unknown.length > 0) {
    validation(
      'scopes',
      ERROR_CODES.VALIDATION_FAILED,
      `unknown scopes: ${unknown.join(', ')}`,
      I18N_KEYS.errors.api_keys.unknown_scope,
    );
  }

  // A key that could act beyond its issuer would turn key creation into privilege escalation.
  const held = new Set<string>(grantedToIssuer);
  const escalating = scopes.filter((scope) => !held.has(scope));
  if (escalating.length > 0) {
    validation(
      'scopes',
      ERROR_CODES.API_KEY_SCOPE_EXCEEDS_GRANT,
      `scopes exceed the issuer's own permissions: ${escalating.join(', ')}`,
      I18N_KEYS.errors.api_keys.scope_exceeds_grant,
    );
  }

  return [...new Set(scopes)] as Permission[];
}

function assertFutureExpiry(expiresAt: Date | null | undefined, now: Date): Date | null {
  if (expiresAt === null || expiresAt === undefined) return null;
  if (expiresAt.getTime() <= now.getTime()) {
    validation(
      'expiresAt',
      ERROR_CODES.VALIDATION_FAILED,
      'expiresAt must be in the future',
      I18N_KEYS.errors.api_keys.expiry_in_past,
    );
  }
  return expiresAt;
}

export class ApiKey {
  private constructor(private readonly props: ApiKeyProps) {}

  static issue(input: IssueApiKeyInput, secret: GeneratedApiKey = generateApiKey()): IssuedApiKey {
    const now = new Date();
    const scopes = assertScopes(input.scopes, input.grantedToIssuer);
    const expiresAt = assertFutureExpiry(input.expiresAt, now);

    const entity = new ApiKey({
      id: generateId(),
      organizationId: input.organizationId,
      name: assertNonEmptyName(input.name),
      prefix: secret.prefix,
      keyHash: secret.hash,
      scopes,
      createdById: input.createdById,
      lastUsedAt: null,
      expiresAt,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    return { entity, raw: secret.raw };
  }

  static reconstitute(raw: ApiKeyProps): ApiKey {
    return new ApiKey(raw);
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
  get prefix(): string {
    return this.props.prefix;
  }
  get keyHash(): string {
    return this.props.keyHash;
  }
  get scopes(): readonly Permission[] {
    return this.props.scopes;
  }
  get createdById(): string | null {
    return this.props.createdById;
  }
  get lastUsedAt(): Date | null {
    return this.props.lastUsedAt;
  }
  get expiresAt(): Date | null {
    return this.props.expiresAt;
  }
  get revokedAt(): Date | null {
    return this.props.revokedAt;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
