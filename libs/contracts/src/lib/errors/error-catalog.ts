import { ERROR_CODES, errorTypeSlug, type ErrorCode } from './error-codes';

// RFC 9457 §3.1.1: a problem type URI SHOULD resolve to human-readable documentation. This catalog
// is that documentation — the api serves it at the same `/errors/<slug>` the `type` member points
// at, so a client hitting an unfamiliar error can follow the URI instead of guessing.
export interface ErrorTypeDoc {
  readonly code: ErrorCode;
  // The status this code is emitted with. A few codes are reachable from more than one status;
  // `status` records the canonical one and `meaning` calls out the exception.
  readonly status: number;
  readonly title: string;
  readonly meaning: string;
  readonly resolution: string;
}

const DOCS: readonly ErrorTypeDoc[] = [
  {
    code: ERROR_CODES.BAD_REQUEST,
    status: 400,
    title: 'Bad request',
    meaning:
      'The request could not be understood — a header, query string or body failed to parse.',
    resolution: 'Fix the request syntax. Retrying the same bytes will fail identically.',
  },
  {
    code: ERROR_CODES.UNAUTHORIZED,
    status: 401,
    title: 'Unauthorized',
    meaning:
      'No valid session. The `better-auth.session_token` cookie is absent, expired or was revoked.',
    resolution: 'Sign in again via POST /api/auth/sign-in/email, then replay the request.',
  },
  {
    code: ERROR_CODES.FORBIDDEN,
    status: 403,
    title: 'Forbidden',
    meaning: 'The session is valid but lacks the role or ownership the route requires.',
    resolution: 'Do not retry with the same account. Request access, or act as the owning user.',
  },
  {
    code: ERROR_CODES.NOT_FOUND,
    status: 404,
    title: 'Not found',
    meaning:
      'The resource does not exist, or the caller is not allowed to learn that it does. Both cases answer identically on purpose — a distinguishable 403 would leak existence.',
    resolution: 'Check the identifier. Do not infer from a 404 that the resource never existed.',
  },
  {
    code: ERROR_CODES.METHOD_NOT_ALLOWED,
    status: 405,
    title: 'Method not allowed',
    meaning: 'The path exists but not for this HTTP method.',
    resolution: 'Use a method listed for the route in the OpenAPI spec.',
  },
  {
    code: ERROR_CODES.CONFLICT,
    status: 409,
    title: 'Conflict',
    meaning:
      'The request collided with current state — a duplicate unique value, a stale version, or work already in flight.',
    resolution: 'Re-read the resource and decide from its current state before retrying.',
  },
  {
    code: ERROR_CODES.UNPROCESSABLE_ENTITY,
    status: 422,
    title: 'Unprocessable entity',
    meaning: 'The request parsed correctly but broke a rule the server enforces.',
    resolution: 'Correct the offending field. The same payload will keep failing.',
  },
  {
    code: ERROR_CODES.RATE_LIMITED,
    status: 429,
    title: 'Too many requests',
    meaning: 'A rate-limit bucket for this caller is exhausted.',
    resolution: 'Wait the number of seconds in the `Retry-After` response header, then retry.',
  },
  {
    code: ERROR_CODES.INTERNAL_SERVER_ERROR,
    status: 500,
    title: 'Internal server error',
    meaning:
      'An unhandled failure. The response body is deliberately generic in every environment; the cause is recorded server-side against `requestId`.',
    resolution: 'Retry once. If it persists, report the `requestId` from the response body.',
  },
  {
    code: ERROR_CODES.SERVICE_UNAVAILABLE,
    status: 503,
    title: 'Service unavailable',
    meaning: 'A dependency the request needs (database, cache, queue) is not currently reachable.',
    resolution: 'Retry with backoff. This condition is expected to be transient.',
  },
  {
    code: ERROR_CODES.REQUEST_TIMEOUT,
    status: 504,
    title: 'Request timeout',
    meaning:
      'The handler exceeded HTTP_REQUEST_TIMEOUT_MS. Only the client wait was aborted — server-side work may still complete.',
    resolution:
      'Retry idempotent requests freely. For mutations, send an `Idempotency-Key` so a retry cannot duplicate the effect.',
  },
  {
    code: ERROR_CODES.NOT_IMPLEMENTED,
    status: 501,
    title: 'Not implemented',
    meaning: 'The route exists but its handler is a scaffold that was never filled in.',
    resolution: 'Not a client error — the endpoint is unfinished. Do not retry.',
  },
  {
    code: ERROR_CODES.ROUTE_NOT_FOUND,
    status: 404,
    title: 'Route not found',
    meaning: 'No route matches this path. An unmatched method on an existing path also lands here.',
    resolution: 'Check the path and version prefix (`/api/v1/...`) against the OpenAPI spec.',
  },
  {
    code: ERROR_CODES.VALIDATION_FAILED,
    status: 422,
    title: 'Validation failed',
    meaning:
      'One or more fields failed validation. The `errors[]` extension lists each one with a `path` and a stable `code`; rejected values are never echoed back.',
    resolution:
      'Fix every entry in `errors[]`. Key client-side messages off `code`, not `message`.',
  },
  {
    code: ERROR_CODES.PAYLOAD_TOO_LARGE,
    status: 413,
    title: 'Payload too large',
    meaning:
      'The body exceeded HTTP_BODY_LIMIT_BYTES, or an upload exceeded UPLOAD_MAX_FILE_BYTES.',
    resolution: 'Send a smaller body. Large files go through the presign flow, not a direct POST.',
  },
  {
    code: ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
    status: 415,
    title: 'Unsupported media type',
    meaning: 'The `Content-Type` is not one this route accepts.',
    resolution: 'Send `application/json` unless the route documents otherwise.',
  },
  {
    code: ERROR_CODES.BUSINESS_RULE_VIOLATION,
    status: 422,
    title: 'Business rule violation',
    meaning: 'A domain rule rejected the request. `errors[]` names the rule that fired.',
    resolution: 'Change the request so it satisfies the rule. Retrying unchanged cannot succeed.',
  },
  {
    code: ERROR_CODES.IDEMPOTENCY_KEY_INVALID,
    status: 400,
    title: 'Invalid idempotency key',
    meaning: 'The `Idempotency-Key` header is empty, too long, or contains disallowed characters.',
    resolution: 'Send an opaque key such as a UUID.',
  },
  {
    code: ERROR_CODES.IDEMPOTENCY_KEY_CONFLICT,
    status: 409,
    title: 'Idempotency key in flight',
    meaning: 'A request with this key is still being processed.',
    resolution: 'Wait and retry with the same key — the stored response is replayed once it lands.',
  },
  {
    code: ERROR_CODES.IDEMPOTENCY_KEY_MISMATCH,
    status: 422,
    title: 'Idempotency key reused with a different body',
    meaning: 'This key was already used for a different payload. Replaying it would be ambiguous.',
    resolution: 'Use a fresh key for a different request body.',
  },
  {
    code: ERROR_CODES.USER_NOT_FOUND,
    status: 404,
    title: 'User not found',
    meaning: 'No user matches the supplied identifier.',
    resolution: 'Verify the id. Ids in this API are UUID v7.',
  },
  {
    code: ERROR_CODES.USER_ALREADY_EXISTS,
    status: 409,
    title: 'User already exists',
    meaning: 'The email is already registered.',
    resolution: 'Sign in instead, or start a password reset.',
  },
  {
    code: ERROR_CODES.INVALID_AUDIT_LOG_ID,
    status: 400,
    title: 'Invalid audit log id',
    meaning: 'The audit log id is not a value the database can accept as a UUID.',
    resolution: 'Pass an id taken verbatim from a previous list response.',
  },
  {
    code: ERROR_CODES.INVALID_CURSOR,
    status: 400,
    title: 'Invalid cursor',
    meaning:
      'The `startingAfter` cursor did not decode. Cursors are opaque `base64url(timestamp:id)` values and are not constructible by hand.',
    resolution: 'Restart pagination without a cursor, then follow the value the API returns.',
  },
  {
    code: ERROR_CODES.UPLOAD_MIME_NOT_ALLOWED,
    status: 422,
    title: 'Upload media type not allowed',
    meaning: 'The declared content type is outside the upload allow-list.',
    resolution: 'Upload a permitted type. The allow-list is enforced by magic bytes, not by name.',
  },
  {
    code: ERROR_CODES.UPLOAD_SIZE_OUT_OF_RANGE,
    status: 422,
    title: 'Upload size out of range',
    meaning: 'The declared or actual object size is zero, or above UPLOAD_MAX_FILE_BYTES.',
    resolution: 'Send a non-empty object within the documented limit.',
  },
  {
    code: ERROR_CODES.UPLOAD_MAGIC_BYTES_UNKNOWN,
    status: 422,
    title: 'Upload file signature unrecognised',
    meaning: 'The leading bytes match no known signature, so the real type cannot be established.',
    resolution: 'Upload an intact file of a supported type.',
  },
  {
    code: ERROR_CODES.UPLOAD_MAGIC_BYTES_MISMATCH,
    status: 422,
    title: 'Upload file signature mismatch',
    meaning: 'The bytes belong to a different type than the one declared at presign time.',
    resolution: 'Declare the true content type, or upload the file the declaration described.',
  },
  {
    code: ERROR_CODES.UPLOAD_COMMIT_FAILED,
    status: 409,
    title: 'Upload commit failed',
    meaning: 'The object could not be moved out of quarantine into its committed location.',
    resolution: 'Retry the confirm call. Presign again if it keeps failing.',
  },
  {
    code: ERROR_CODES.UPLOAD_IN_PROGRESS,
    status: 409,
    title: 'Upload already in progress',
    meaning: 'This object is already being verified by the worker.',
    resolution: 'Wait for verification to settle before confirming again.',
  },
];

// A Map, not a plain object: the slug comes straight off the URL, and an object lookup would answer
// `__proto__`/`constructor` with something truthy from the prototype chain and render a junk page.
export const ERROR_CATALOG: ReadonlyMap<string, ErrorTypeDoc> = new Map(
  DOCS.map((doc) => [errorTypeSlug(doc.code), doc]),
);

export const ERROR_CATALOG_ENTRIES: readonly ErrorTypeDoc[] = DOCS;

export function findErrorTypeDoc(slug: string): ErrorTypeDoc | undefined {
  return ERROR_CATALOG.get(slug);
}
