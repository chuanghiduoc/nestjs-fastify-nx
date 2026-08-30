export const QUEUE_NAMES = {
  EMAIL_NOTIFICATION: 'email-notification',
  UPLOAD_VERIFICATION: 'upload-verification',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const BULL_JOB_NAMES = {
  AUTH_EMAIL: 'auth-email',
  WELCOME_EMAIL: 'welcome-email',
  VERIFY_MAGIC_BYTES: 'verify-magic-bytes',
} as const;
