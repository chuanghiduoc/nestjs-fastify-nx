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
