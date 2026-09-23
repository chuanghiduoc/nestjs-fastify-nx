import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiExtraModels, ApiResponse } from '@nestjs/swagger';
import { ProblemDetailsDto, ValidationProblemDetailsDto } from '../errors/problem-details.dto';
import { errorTypeUrl } from '../errors/error-codes';

const PROBLEM_JSON = 'application/problem+json';

// Fixed sample values so every documented error renders a self-consistent body. They are illustrative
// only — at runtime `requestId`/`timestamp` are generated per request and `instance` is the actual
// request path. `instance` is a neutral placeholder (NOT a real route) because this decorator is
// shared across every controller and can't know the specific path at decoration time; a concrete
// path like `/api/v1/users/me` would show under unrelated endpoints and misread as their real path.
const EXAMPLE_REQUEST_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const EXAMPLE_TIMESTAMP = '2026-04-30T22:28:27.356Z';
const EXAMPLE_INSTANCE = '/api/v1/resource';

export interface ProblemExampleInput {
  status: number;
  code: string;
  title: string;
  detail: string;
}

// A single ApiResponse cannot express a per-status example through the shared `$ref` schema alone:
// Swagger UI would otherwise synthesize one body from the DTO's property-level examples and show the
// SAME (404-flavoured) payload under every status tab. Attaching an explicit `example` per status is
// what makes the 401/403/409/… tabs render a body whose `status`/`code`/`title` actually match the tab.
// Exported so other spec spots that reuse `$ref: ProblemDetailsDto` (Better Auth 429/500, health 503)
// attach a status-matched example the same way instead of falling back to the misleading default.
export const buildProblemExample = ({ status, code, title, detail }: ProblemExampleInput) => ({
  type: errorTypeUrl(code),
  title,
  status,
  detail,
  instance: EXAMPLE_INSTANCE,
  code,
  requestId: EXAMPLE_REQUEST_ID,
  timestamp: EXAMPLE_TIMESTAMP,
});

const problemResponse = (input: ProblemExampleInput & { description: string }) => ({
  status: input.status,
  description: input.description,
  content: {
    [PROBLEM_JSON]: {
      schema: { $ref: '#/components/schemas/ProblemDetailsDto' },
      example: buildProblemExample(input),
    },
  },
});

const validationResponse = () => ({
  status: HttpStatus.UNPROCESSABLE_ENTITY,
  description: 'Validation failed — see `errors[]` for per-field details.',
  content: {
    [PROBLEM_JSON]: {
      schema: { $ref: '#/components/schemas/ValidationProblemDetailsDto' },
      example: {
        ...buildProblemExample({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          code: 'validation_failed',
          title: 'Unprocessable Entity',
          detail: 'The request failed validation — see `errors[]`.',
        }),
        // Field-agnostic sample: this decorator is shared across every endpoint, so a concrete field
        // like `email`/isEmail would appear (and mislead) on routes that have no such field.
        errors: [
          {
            path: 'fieldName',
            code: 'invalid',
            message: 'This field failed validation.',
            rule: 'isNotEmpty',
          },
        ],
      },
    },
  },
});

export interface CommonErrorsOptions {
  /** Endpoint requires authentication — include 401. Default: true. */
  auth?: boolean;
  /**
   * Include 403. Ignored when `auth` is true: 403 is not only about roles — BetterAuthGuard
   * rejects a valid session belonging to a non-ACTIVE account with 403, so every authenticated
   * endpoint can emit it whether or not it declares a required role. Default: false.
   */
  forbidden?: boolean;
  /** Endpoint reads/operates on a resource by id — include 404. Default: false. */
  notFound?: boolean;
  /** Endpoint can fail on a state conflict (e.g. duplicate, version mismatch) — include 409. Default: false. */
  conflict?: boolean;
  /** Endpoint accepts a request body or query that goes through validation — include 422. Default: true. */
  validation?: boolean;
  /** Endpoint can return 415 (unsupported media type), e.g. multipart-only routes. Default: false. */
  unsupportedMediaType?: boolean;
  /** Endpoint can return 413 (payload too large), e.g. upload routes. Default: false. */
  payloadTooLarge?: boolean;
  /**
   * Include the generic 503. Set false only when the endpoint documents its own richer 503 (the
   * health probes attach a `checks` breakdown); the generic entry would overwrite it. Default: true.
   */
  serviceUnavailable?: boolean;
}

interface ResolvedCommonErrorsOptions {
  auth: boolean;
  forbidden: boolean;
  notFound: boolean;
  conflict: boolean;
  validation: boolean;
  unsupportedMediaType: boolean;
  payloadTooLarge: boolean;
  serviceUnavailable: boolean;
}

const resolveOptions = (options: CommonErrorsOptions): ResolvedCommonErrorsOptions => {
  const auth = options.auth ?? true;
  return {
    auth,
    // Forced on for authenticated routes — see CommonErrorsOptions.forbidden. Opting out would
    // document a contract the guard does not honour.
    forbidden: auth || (options.forbidden ?? false),
    notFound: options.notFound ?? false,
    conflict: options.conflict ?? false,
    validation: options.validation ?? true,
    unsupportedMediaType: options.unsupportedMediaType ?? false,
    payloadTooLarge: options.payloadTooLarge ?? false,
    serviceUnavailable: options.serviceUnavailable ?? true,
  };
};

interface CommonErrorEntry {
  enabled: (options: ResolvedCommonErrorsOptions) => boolean;
  status: number;
  code: string;
  title: string;
  detail: string;
  description?: string;
}

const LEADING_ERROR_TABLE: CommonErrorEntry[] = [
  {
    enabled: () => true,
    status: HttpStatus.BAD_REQUEST,
    code: 'bad_request',
    title: 'Bad Request',
    detail: 'Malformed request — invalid JSON, missing required headers, etc.',
  },
  {
    enabled: (options) => options.auth,
    status: HttpStatus.UNAUTHORIZED,
    code: 'unauthorized',
    title: 'Unauthorized',
    detail: 'Authentication required or the session cookie is missing or invalid.',
    description: 'Authentication required or session invalid.',
  },
  {
    enabled: (options) => options.forbidden,
    status: HttpStatus.FORBIDDEN,
    code: 'forbidden',
    title: 'Forbidden',
    detail: 'Authenticated, but lacking permission for this resource.',
  },
  {
    enabled: (options) => options.notFound,
    status: HttpStatus.NOT_FOUND,
    code: 'not_found',
    title: 'Not Found',
    detail: 'The requested resource does not exist.',
    description: 'Resource not found.',
  },
  {
    enabled: (options) => options.conflict,
    status: HttpStatus.CONFLICT,
    code: 'conflict',
    title: 'Conflict',
    detail: 'State conflict — e.g. duplicate key, stale version, concurrent update.',
  },
  {
    enabled: (options) => options.payloadTooLarge,
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    code: 'payload_too_large',
    title: 'Payload Too Large',
    detail: 'Request body exceeds the configured size limit.',
  },
  {
    enabled: (options) => options.unsupportedMediaType,
    status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    code: 'unsupported_media_type',
    title: 'Unsupported Media Type',
    detail: 'Request Content-Type is not accepted by this endpoint.',
  },
];

// Both are raised by process-wide mechanisms rather than by any handler, so every route can answer
// with them: @fastify/under-pressure sheds load with 503, and the global TimeoutInterceptor aborts a
// handler past HTTP_REQUEST_TIMEOUT_MS with 504. Omitting them documents a contract narrower than the
// one the server actually honours.
const TRAILING_ERROR_TABLE: CommonErrorEntry[] = [
  {
    enabled: () => true,
    status: HttpStatus.TOO_MANY_REQUESTS,
    code: 'rate_limited',
    title: 'Too Many Requests',
    detail: 'Rate limit exceeded — see the `Retry-After` response header.',
  },
  {
    enabled: () => true,
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'internal_server_error',
    title: 'Internal Server Error',
    detail: 'Unexpected server error. Quote the `requestId` field when contacting support.',
  },
  {
    enabled: () => true,
    status: HttpStatus.GATEWAY_TIMEOUT,
    code: 'request_timeout',
    title: 'Gateway Timeout',
    detail: 'The request exceeded the server time budget and was aborted.',
  },
  {
    enabled: (options) => options.serviceUnavailable,
    status: HttpStatus.SERVICE_UNAVAILABLE,
    code: 'service_unavailable',
    title: 'Service Unavailable',
    detail: 'The service is shedding load or a required dependency is unavailable.',
  },
];

const toApiResponse = (entry: CommonErrorEntry) =>
  ApiResponse(
    problemResponse({
      status: entry.status,
      code: entry.code,
      title: entry.title,
      detail: entry.detail,
      description: entry.description ?? entry.detail,
    }),
  );

// Documents Problem Details error responses (always 400, 429, 500 plus selected optional codes).
export const ApiCommonErrors = (options: CommonErrorsOptions = {}) => {
  const resolved = resolveOptions(options);

  const decorators: MethodDecorator[] = [
    ApiExtraModels(ProblemDetailsDto, ValidationProblemDetailsDto),
    ...LEADING_ERROR_TABLE.filter((entry) => entry.enabled(resolved)).map(toApiResponse),
  ];

  if (resolved.validation) {
    decorators.push(ApiResponse(validationResponse()));
  }

  decorators.push(
    ...TRAILING_ERROR_TABLE.filter((entry) => entry.enabled(resolved)).map(toApiResponse),
  );

  return applyDecorators(...decorators);
};
