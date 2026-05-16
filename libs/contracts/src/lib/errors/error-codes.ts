// Stable error codes for the Problem Details `code` field. Frontend uses
// these as i18n keys and for switch-case logic — DO NOT rename existing
// entries without a coordinated release; only add new ones.
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

// RFC 9457 §3.1: the `type` field MAY be a relative URI. We default to the
// relative path `/errors/<slug>` so responses never leak a placeholder domain
// (the previous default was `api.example.com` which is not a real host).
// Operators who publish error docs externally can set `ERROR_DOCS_BASE_URL`
// to an absolute URL like `https://docs.example.com/errors` to get absolute
// `type` URIs back. Read at call time so hot-reloaded env in dev applies.
export function errorTypeUrl(code: string): string {
  const base = process.env['ERROR_DOCS_BASE_URL']?.trim() || '/errors';
  return `${base.replace(/\/+$/, '')}/${code.replace(/_/g, '-')}`;
}
