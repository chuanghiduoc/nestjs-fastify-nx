export const QUEUE_NAMES = {
  EMAIL_NOTIFICATION: 'email-notification',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
