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

  ROUTE_NOT_FOUND: 'route_not_found',
  VALIDATION_FAILED: 'validation_failed',
  PAYLOAD_TOO_LARGE: 'payload_too_large',
  UNSUPPORTED_MEDIA_TYPE: 'unsupported_media_type',
  BUSINESS_RULE_VIOLATION: 'business_rule_violation',

  IDEMPOTENCY_KEY_INVALID: 'idempotency_key_invalid',
  IDEMPOTENCY_KEY_CONFLICT: 'idempotency_key_conflict',
  IDEMPOTENCY_KEY_MISMATCH: 'idempotency_key_mismatch',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// RFC 9457 §3.1 type URI. Set ERROR_DOCS_BASE_URL for absolute URIs.
export function errorTypeUrl(code: string): string {
  const base = process.env['ERROR_DOCS_BASE_URL']?.trim() || '/errors';
  return `${base.replace(/\/+$/, '')}/${code.replace(/_/g, '-')}`;
}
