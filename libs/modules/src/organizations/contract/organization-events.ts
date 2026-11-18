import { z } from 'zod';

const organizationIdentityPayloadSchema = z.object({
  name: z.string(),
  slug: z.string(),
});

const membershipPayloadSchema = z.object({
  userId: z.uuid(),
  role: z.string(),
});

export const organizationCreatedPayloadSchema = organizationIdentityPayloadSchema;
export type OrganizationCreatedPayload = z.infer<typeof organizationCreatedPayloadSchema>;

export const organizationDeletedPayloadSchema = organizationIdentityPayloadSchema;
export type OrganizationDeletedPayload = z.infer<typeof organizationDeletedPayloadSchema>;

export const organizationMemberAddedPayloadSchema = membershipPayloadSchema;
export type OrganizationMemberAddedPayload = z.infer<typeof organizationMemberAddedPayloadSchema>;

export const organizationMemberRemovedPayloadSchema = membershipPayloadSchema;
export type OrganizationMemberRemovedPayload = z.infer<
  typeof organizationMemberRemovedPayloadSchema
>;

export const organizationMemberRoleUpdatedPayloadSchema = membershipPayloadSchema.extend({
  oldRole: z.string(),
});
export type OrganizationMemberRoleUpdatedPayload = z.infer<
  typeof organizationMemberRoleUpdatedPayloadSchema
>;

export const organizationRoleChangedPayloadSchema = z.object({
  role: z.string(),
  action: z.enum(['INSERT', 'UPDATE', 'DELETE']),
});
export type OrganizationRoleChangedPayload = z.infer<typeof organizationRoleChangedPayloadSchema>;
