import { z } from 'zod';

export const EMAIL_TEMPLATES = {
  WELCOME: 'welcome',
  EMAIL_VERIFICATION: 'email-verification',
  PASSWORD_RESET: 'password-reset',
  EMAIL_CHANGE_CONFIRMATION: 'email-change-confirmation',
  ACCOUNT_DELETION: 'account-deletion',
  ORGANIZATION_INVITATION: 'organization-invitation',
} as const;

export type EmailTemplate = (typeof EMAIL_TEMPLATES)[keyof typeof EMAIL_TEMPLATES];

export const GENERIC_EMAIL_TEMPLATE = 'generic';

export interface EmailNotificationPayload {
  to: string;
  subject: string;
  body: string;
  templateId?: EmailTemplate | typeof GENERIC_EMAIL_TEMPLATE;
  variables?: Record<string, string>;
  correlationId?: string;
}

export const emailNotificationPayloadSchema = z.object({
  to: z.email(),
  subject: z.string().min(1),
  body: z.string(),
  templateId: z.string().optional(),
  variables: z.record(z.string(), z.string()).optional(),
  correlationId: z.string().optional(),
});
