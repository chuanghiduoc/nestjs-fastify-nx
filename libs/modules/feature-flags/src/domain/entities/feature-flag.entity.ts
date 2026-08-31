import { createHash } from 'node:crypto';
import { DomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS } from '@nestjs-fastify-nx/contracts';
import { generateId } from '@nestjs-fastify-nx/shared';

const KEY_PATTERN = /^[a-z][a-z0-9._-]{1,99}$/;
const ROLLOUT_MIN = 0;
const ROLLOUT_MAX = 100;
const BUCKET_COUNT = 100;

export interface FeatureFlagProps {
  id: string;
  organizationId: string;
  key: string;
  description: string | null;
  enabled: boolean;
  rolloutPercentage: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFeatureFlagInput {
  id?: string;
  organizationId: string;
  key: string;
  description?: string | null;
  enabled?: boolean;
  rolloutPercentage?: number;
}

export interface FeatureFlagChanges {
  description?: string | null;
  enabled?: boolean;
  rolloutPercentage?: number;
}

function validation(path: string, code: string, message: string, messageKey: string): never {
  throw new DomainException({
    kind: 'validation',
    code,
    title: I18N_KEYS.common.unprocessable_entity,
    messageKey,
    violations: [{ path, code, message, messageKey }],
  });
}

function assertKey(key: string): string {
  if (!KEY_PATTERN.test(key)) {
    validation(
      'key',
      ERROR_CODES.VALIDATION_FAILED,
      'key must be 2-100 characters of lowercase letters, digits, dot, hyphen or underscore, starting with a letter',
      I18N_KEYS.errors.feature_flags.invalid_key,
    );
  }
  return key;
}

function assertRollout(percentage: number): number {
  if (!Number.isInteger(percentage) || percentage < ROLLOUT_MIN || percentage > ROLLOUT_MAX) {
    validation(
      'rolloutPercentage',
      ERROR_CODES.VALIDATION_FAILED,
      `rolloutPercentage must be an integer between ${ROLLOUT_MIN} and ${ROLLOUT_MAX}`,
      I18N_KEYS.errors.feature_flags.invalid_rollout,
    );
  }
  return percentage;
}

export class FeatureFlag {
  private constructor(private readonly props: FeatureFlagProps) {}

  static create(input: CreateFeatureFlagInput): FeatureFlag {
    const now = new Date();
    return new FeatureFlag({
      id: input.id ?? generateId(),
      organizationId: input.organizationId,
      key: assertKey(input.key),
      description: input.description ?? null,
      enabled: input.enabled ?? false,
      rolloutPercentage: assertRollout(input.rolloutPercentage ?? ROLLOUT_MAX),
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(raw: FeatureFlagProps): FeatureFlag {
    return new FeatureFlag(raw);
  }

  withChanges(changes: FeatureFlagChanges): FeatureFlag {
    return new FeatureFlag({
      ...this.props,
      description: changes.description === undefined ? this.props.description : changes.description,
      enabled: changes.enabled ?? this.props.enabled,
      rolloutPercentage:
        changes.rolloutPercentage === undefined
          ? this.props.rolloutPercentage
          : assertRollout(changes.rolloutPercentage),
      updatedAt: new Date(),
    });
  }

  /**
   * Deterministic per-subject bucketing: the same subject always lands in the same bucket for a
   * given flag, so a partial rollout stays stable across requests and processes instead of
   * flickering per call the way `Math.random()` would.
   */
  isEnabledFor(subjectId: string): boolean {
    if (!this.props.enabled) return false;
    if (this.props.rolloutPercentage >= ROLLOUT_MAX) return true;
    if (this.props.rolloutPercentage <= ROLLOUT_MIN) return false;

    const digest = createHash('sha256').update(`${this.props.key}:${subjectId}`).digest();
    return digest.readUInt32BE(0) % BUCKET_COUNT < this.props.rolloutPercentage;
  }

  get id(): string {
    return this.props.id;
  }
  get organizationId(): string {
    return this.props.organizationId;
  }
  get key(): string {
    return this.props.key;
  }
  get description(): string | null {
    return this.props.description;
  }
  get enabled(): boolean {
    return this.props.enabled;
  }
  get rolloutPercentage(): number {
    return this.props.rolloutPercentage;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
