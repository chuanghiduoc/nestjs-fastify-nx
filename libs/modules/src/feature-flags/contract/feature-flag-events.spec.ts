import { describe, expect, it } from 'vitest';
import { generateId } from '@nestjs-fastify-nx/shared';
import {
  featureFlagCreatedPayloadSchema,
  featureFlagDeletedPayloadSchema,
  featureFlagUpdatedPayloadSchema,
} from './index';

const created = {
  userId: generateId(),
  key: 'checkout.new-flow',
  enabled: false,
  rolloutPercentage: 0,
  description: null,
};

describe('feature flag event payload schemas', () => {
  it('feature_flags.created accepts the payload its handler publishes', () => {
    expect(featureFlagCreatedPayloadSchema.safeParse(created).success).toBe(true);
  });

  it.each(['userId', 'key', 'enabled', 'rolloutPercentage', 'description'])(
    'feature_flags.created rejects a payload without %s',
    (field) => {
      const { [field as keyof typeof created]: _omitted, ...rest } = created;
      expect(featureFlagCreatedPayloadSchema.safeParse(rest).success).toBe(false);
    },
  );

  it('feature_flags.updated requires the previous values next to the new ones', () => {
    const updated = { ...created, previousEnabled: true, previousRolloutPercentage: 50 };
    expect(featureFlagUpdatedPayloadSchema.safeParse(updated).success).toBe(true);
    expect(featureFlagUpdatedPayloadSchema.safeParse(created).success).toBe(false);
  });

  it('feature_flags.deleted requires the acting user', () => {
    expect(featureFlagDeletedPayloadSchema.safeParse({ userId: generateId() }).success).toBe(true);
    expect(featureFlagDeletedPayloadSchema.safeParse({}).success).toBe(false);
  });
});
