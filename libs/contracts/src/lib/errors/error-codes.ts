// DO NOT rename — frontend uses these as stable i18n keys.
export const ERROR_CODES = {
  BAD_REQUEST: 'bad_request',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  METHOD_NOT_ALLOWED: 'method_not_allowed',
  CONFLICT: 'conflict',
  UNPROCESSABLE_ENTITY: 'unprocessable_entity',
  RATE_LIMITED: 'rate_limited',
  INTERNAL_SERVER_ERROR: 'internal_server_error',
  SERVICE_UNAVAILABLE: 'service_unavailable',
  REQUEST_TIMEOUT: 'request_timeout',
  NOT_IMPLEMENTED: 'not_implemented',

  ROUTE_NOT_FOUND: 'route_not_found',
  VALIDATION_FAILED: 'validation_failed',
  PAYLOAD_TOO_LARGE: 'payload_too_large',
  UNSUPPORTED_MEDIA_TYPE: 'unsupported_media_type',
  BUSINESS_RULE_VIOLATION: 'business_rule_violation',

  IDEMPOTENCY_KEY_INVALID: 'idempotency_key_invalid',
  IDEMPOTENCY_KEY_CONFLICT: 'idempotency_key_conflict',
  IDEMPOTENCY_KEY_MISMATCH: 'idempotency_key_mismatch',

  // Domain rule violations. A DomainException must carry one of these, never an ad-hoc string —
  // the client keys its i18n off this value.
  USER_NOT_FOUND: 'user_not_found',
  USER_ALREADY_EXISTS: 'user_already_exists',
  INVALID_AUDIT_LOG_ID: 'invalid_audit_log_id',
  INVALID_CURSOR: 'invalid_cursor',
  UPLOAD_MIME_NOT_ALLOWED: 'upload_mime_not_allowed',
  UPLOAD_SIZE_OUT_OF_RANGE: 'upload_size_out_of_range',
  UPLOAD_MAGIC_BYTES_UNKNOWN: 'upload_magic_bytes_unknown',
  UPLOAD_MAGIC_BYTES_MISMATCH: 'upload_magic_bytes_mismatch',
  UPLOAD_COMMIT_FAILED: 'upload_commit_failed',
  UPLOAD_IN_PROGRESS: 'upload_in_progress',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// The path segment a `type` URI ends with, and the key the api serves its documentation under.
export function errorTypeSlug(code: string): string {
  return code.replace(/_/g, '-');
}

// RFC 9457 §3.1 type URI. Set ERROR_DOCS_BASE_URL for absolute URIs.
export function errorTypeUrl(code: string): string {
  const base = process.env['ERROR_DOCS_BASE_URL']?.trim() || '/errors';
  return `${base.replace(/\/+$/, '')}/${errorTypeSlug(code)}`;
}
