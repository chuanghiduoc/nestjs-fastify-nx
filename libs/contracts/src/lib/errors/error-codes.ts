/**
 * Stable error codes for the Problem Details `code` field. Frontend uses these
 * as i18n keys and for switch-case logic — DO NOT rename existing entries
 * without a coordinated release; only add new ones.
 *
 * Each code maps to a documentation slug (`/errors/<slug>`) by replacing `_`
 * with `-`. Override the docs URL via `ERROR_DOCS_BASE_URL` env var.
 */
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

  ROUTE_NOT_FOUND: 'route_not_found',
  VALIDATION_FAILED: 'validation_failed',
  PAYLOAD_TOO_LARGE: 'payload_too_large',
  UNSUPPORTED_MEDIA_TYPE: 'unsupported_media_type',
  BUSINESS_RULE_VIOLATION: 'business_rule_violation',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const DOCS_BASE_URL = process.env['ERROR_DOCS_BASE_URL'] ?? 'https://api.example.com/errors';

export function errorTypeUrl(code: string): string {
  return `${DOCS_BASE_URL}/${code.replace(/_/g, '-')}`;
}
