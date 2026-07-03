import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiExtraModels, ApiResponse } from '@nestjs/swagger';
import { ProblemDetailsDto, ValidationProblemDetailsDto } from '../errors/problem-details.dto';

const PROBLEM_JSON = 'application/problem+json';

const problemContent = (description: string) => ({
  description,
  content: { [PROBLEM_JSON]: { schema: { $ref: '#/components/schemas/ProblemDetailsDto' } } },
});

const validationProblemContent = (description: string) => ({
  description,
  content: {
    [PROBLEM_JSON]: { schema: { $ref: '#/components/schemas/ValidationProblemDetailsDto' } },
  },
});

export interface CommonErrorsOptions {
  /** Endpoint requires authentication — include 401. Default: true. */
  auth?: boolean;
  /** Endpoint requires a specific role/permission — include 403. Default: true when `auth` is true. */
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
  const forbidden = options.forbidden ?? auth;
  const validation = options.validation ?? true;
  const notFound = options.notFound ?? false;
  const conflict = options.conflict ?? false;
  const unsupportedMediaType = options.unsupportedMediaType ?? false;
  const payloadTooLarge = options.payloadTooLarge ?? false;

  const decorators: MethodDecorator[] = [
    ApiExtraModels(ProblemDetailsDto, ValidationProblemDetailsDto),
    ApiResponse({
      status: HttpStatus.BAD_REQUEST,
      ...problemContent('Malformed request — invalid JSON, missing required headers, etc.'),
    }),
  ];

  if (auth) {
    decorators.push(
      ApiResponse({
        status: HttpStatus.UNAUTHORIZED,
        ...problemContent('Authentication required or session invalid.'),
      }),
    );
  }

  if (forbidden) {
    decorators.push(
      ApiResponse({
        status: HttpStatus.FORBIDDEN,
        ...problemContent('Authenticated, but lacking permission for this resource.'),
      }),
    );
  }

  if (notFound) {
    decorators.push(
      ApiResponse({
        status: HttpStatus.NOT_FOUND,
        ...problemContent('Resource not found.'),
      }),
    );
  }

  if (conflict) {
    decorators.push(
      ApiResponse({
        status: HttpStatus.CONFLICT,
        ...problemContent('State conflict — e.g. duplicate key, stale version, concurrent update.'),
      }),
    );
  }

  if (payloadTooLarge) {
    decorators.push(
      ApiResponse({
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        ...problemContent('Request body exceeds the configured size limit.'),
      }),
    );
  }

  if (unsupportedMediaType) {
    decorators.push(
      ApiResponse({
        status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        ...problemContent('Request Content-Type is not accepted by this endpoint.'),
      }),
    );
  }

  if (validation) {
    decorators.push(
      ApiResponse({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        ...validationProblemContent('Validation failed — see `errors[]` for per-field details.'),
      }),
    );
  }

  decorators.push(
    ApiResponse({
      status: HttpStatus.TOO_MANY_REQUESTS,
      ...problemContent('Rate limit exceeded — see the `Retry-After` response header.'),
    }),
    ApiResponse({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      ...problemContent(
        'Unexpected server error. Quote the `requestId` field when contacting support.',
      ),
    }),
  );

  return applyDecorators(...decorators);
};
