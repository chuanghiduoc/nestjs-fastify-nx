// contracts public API — integration event schemas, cross-module DTOs
// Integration event types will be added here as modules need to communicate
// across boundaries. Domain event base lives in @nestjs-fastify-nx/core.
export { PaginationDto } from './lib/dto/pagination.dto';
export {
  ListResponseDto,
  CursorPaginationDto,
  toListResponse,
  toCursorListResponse,
} from './lib/dto/list-response.dto';
export {
  ProblemDetailsDto,
  ValidationProblemDetailsDto,
  ValidationErrorItemDto,
} from './lib/errors/problem-details.dto';
export { ERROR_CODES, errorTypeSlug, errorTypeUrl, type ErrorCode } from './lib/errors/error-codes';
export {
  ERROR_CATALOG,
  ERROR_CATALOG_ENTRIES,
  findErrorTypeDoc,
  type ErrorTypeDoc,
} from './lib/errors/error-catalog';
export { I18N_KEYS, type I18nKey } from './lib/i18n-keys';
export { VALIDATOR_CODES, validatorToCode } from './lib/validation-codes';
export {
  ApiCommonErrors,
  buildProblemExample,
  type CommonErrorsOptions,
  type ProblemExampleInput,
} from './lib/swagger/api-common-errors.decorator';
export { ApiPaginatedResponse } from './lib/swagger/api-paginated-response.decorator';
