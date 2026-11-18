import { z } from 'zod';

const sessionOriginShape = {
  ip: z.string().optional(),
  userAgent: z.string().optional(),
};

export const userRegisteredPayloadSchema = z.object({
  email: z.email(),
});
export type UserRegisteredPayload = z.infer<typeof userRegisteredPayloadSchema>;

export const userLoggedInPayloadSchema = z.object({
  sessionId: z.uuid(),
  ...sessionOriginShape,
});
export type UserLoggedInPayload = z.infer<typeof userLoggedInPayloadSchema>;

export const userLoggedOutPayloadSchema = z.object({
  tokenId: z.uuid(),
  sessionExpiresAt: z.iso.datetime(),
  ...sessionOriginShape,
});
export type UserLoggedOutPayload = z.infer<typeof userLoggedOutPayloadSchema>;
