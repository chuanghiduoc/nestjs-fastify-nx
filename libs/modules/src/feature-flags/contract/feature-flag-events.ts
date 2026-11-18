import { z } from 'zod';

const actorShape = {
  userId: z.uuid(),
};

export const featureFlagCreatedPayloadSchema = z.object({
  ...actorShape,
  key: z.string(),
  enabled: z.boolean(),
  rolloutPercentage: z.number().int(),
  description: z.string().nullable(),
});
export type FeatureFlagCreatedPayload = z.infer<typeof featureFlagCreatedPayloadSchema>;

export const featureFlagUpdatedPayloadSchema = featureFlagCreatedPayloadSchema.extend({
  previousEnabled: z.boolean(),
  previousRolloutPercentage: z.number().int(),
});
export type FeatureFlagUpdatedPayload = z.infer<typeof featureFlagUpdatedPayloadSchema>;

export const featureFlagDeletedPayloadSchema = z.object(actorShape);
export type FeatureFlagDeletedPayload = z.infer<typeof featureFlagDeletedPayloadSchema>;
