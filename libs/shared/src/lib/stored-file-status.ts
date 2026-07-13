export const STORED_FILE_STATUS = {
  FINALIZING: 'FINALIZING',
  VERIFYING: 'VERIFYING',
  READY: 'READY',
  REJECTED: 'REJECTED',
} as const;

export type StoredFileStatus = (typeof STORED_FILE_STATUS)[keyof typeof STORED_FILE_STATUS];
