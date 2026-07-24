import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiExtraModels, ApiResponse } from '@nestjs/swagger';
import { ProblemDetailsDto, ValidationProblemDetailsDto } from '../errors/problem-details.dto';
import { errorTypeUrl } from '../errors/error-codes';

const PROBLEM_JSON = 'application/problem+json';

// Fixed sample values so every documented error renders a self-consistent body. They are illustrative
// only — `requestId`/`timestamp`/`instance` are populated per request at runtime.
const EXAMPLE_REQUEST_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const EXAMPLE_TIMESTAMP = '2026-04-30T22:28:27.356Z';
const EXAMPLE_INSTANCE = '/api/v1/users/me';

interface ProblemExampleInput {
  status: number;
  code: string;
  title: string;
  detail: string;
}

// A single ApiResponse cannot express a per-status example through the shared `$ref` schema alone:
// Swagger UI would otherwise synthesize one body from the DTO's property-level examples and show the
// SAME (404-flavoured) payload under every status tab. Attaching an explicit `example` per status is
// what makes the 401/403/409/… tabs render a body whose `status`/`code`/`title` actually match the tab.
const problemExample = ({ status, code, title, detail }: ProblemExampleInput) => ({
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
      example: problemExample(input),
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
        ...problemExample({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          code: 'validation_failed',
          title: 'Unprocessable Entity',
          detail: 'The request failed validation — see `errors[]`.',
        }),
        errors: [
          {
            path: 'email',
            code: 'invalid',
            message: 'Must be a valid email address.',
            rule: 'isEmail',
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
}

// Documents Problem Details error responses (always 400, 429, 500 plus selected optional codes).
export const ApiCommonErrors = (options: CommonErrorsOptions = {}) => {
  const auth = options.auth ?? true;
  // Forced on for authenticated routes — see CommonErrorsOptions.forbidden. Opting out would
  // document a contract the guard does not honour.
  const forbidden = auth || (options.forbidden ?? false);
  const validation = options.validation ?? true;
  const notFound = options.notFound ?? false;
  const conflict = options.conflict ?? false;
  const unsupportedMediaType = options.unsupportedMediaType ?? false;
  const payloadTooLarge = options.payloadTooLarge ?? false;

  const decorators: MethodDecorator[] = [
    ApiExtraModels(ProblemDetailsDto, ValidationProblemDetailsDto),
    ApiResponse(
      problemResponse({
        status: HttpStatus.BAD_REQUEST,
        code: 'bad_request',
        title: 'Bad Request',
        detail: 'Malformed request — invalid JSON, missing required headers, etc.',
        description: 'Malformed request — invalid JSON, missing required headers, etc.',
      }),
    ),
  ];

  if (auth) {
    decorators.push(
      ApiResponse(
        problemResponse({
          status: HttpStatus.UNAUTHORIZED,
          code: 'unauthorized',
          title: 'Unauthorized',
          detail: 'Authentication required or the session cookie is missing or invalid.',
          description: 'Authentication required or session invalid.',
        }),
      ),
    );
  }

  if (forbidden) {
    decorators.push(
      ApiResponse(
        problemResponse({
          status: HttpStatus.FORBIDDEN,
          code: 'forbidden',
          title: 'Forbidden',
          detail: 'Authenticated, but lacking permission for this resource.',
          description: 'Authenticated, but lacking permission for this resource.',
        }),
      ),
    );
  }

  if (notFound) {
    decorators.push(
      ApiResponse(
        problemResponse({
          status: HttpStatus.NOT_FOUND,
          code: 'not_found',
          title: 'Not Found',
          detail: 'The requested resource does not exist.',
          description: 'Resource not found.',
        }),
      ),
    );
  }

  if (conflict) {
    decorators.push(
      ApiResponse(
        problemResponse({
          status: HttpStatus.CONFLICT,
          code: 'conflict',
          title: 'Conflict',
          detail: 'State conflict — e.g. duplicate key, stale version, concurrent update.',
          description: 'State conflict — e.g. duplicate key, stale version, concurrent update.',
        }),
      ),
    );
  }

  if (payloadTooLarge) {
    decorators.push(
      ApiResponse(
        problemResponse({
          status: HttpStatus.PAYLOAD_TOO_LARGE,
          code: 'payload_too_large',
          title: 'Payload Too Large',
          detail: 'Request body exceeds the configured size limit.',
          description: 'Request body exceeds the configured size limit.',
        }),
      ),
    );
  }

  if (unsupportedMediaType) {
    decorators.push(
      ApiResponse(
        problemResponse({
          status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
          code: 'unsupported_media_type',
          title: 'Unsupported Media Type',
          detail: 'Request Content-Type is not accepted by this endpoint.',
          description: 'Request Content-Type is not accepted by this endpoint.',
        }),
      ),
    );
  }

  if (validation) {
    decorators.push(ApiResponse(validationResponse()));
  }

  decorators.push(
    ApiResponse(
      problemResponse({
        status: HttpStatus.TOO_MANY_REQUESTS,
        code: 'rate_limited',
        title: 'Too Many Requests',
        detail: 'Rate limit exceeded — see the `Retry-After` response header.',
        description: 'Rate limit exceeded — see the `Retry-After` response header.',
      }),
    ),
    ApiResponse(
      problemResponse({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'internal_server_error',
        title: 'Internal Server Error',
        detail: 'Unexpected server error. Quote the `requestId` field when contacting support.',
        description:
          'Unexpected server error. Quote the `requestId` field when contacting support.',
      }),
    ),
  );

  return applyDecorators(...decorators);
};
