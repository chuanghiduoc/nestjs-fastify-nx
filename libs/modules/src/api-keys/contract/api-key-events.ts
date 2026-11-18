import { z } from 'zod';

const actorShape = {
  userId: z.uuid(),
};

export const apiKeyIssuedPayloadSchema = z.object({
  ...actorShape,
  name: z.string(),
  scopes: z.array(z.string()),
  expiresAt: z.iso.datetime().nullable(),
});
export type ApiKeyIssuedPayload = z.infer<typeof apiKeyIssuedPayloadSchema>;

export const apiKeyRevokedPayloadSchema = z.object(actorShape);
export type ApiKeyRevokedPayload = z.infer<typeof apiKeyRevokedPayloadSchema>;
