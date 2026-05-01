// contracts public API — integration event schemas, cross-module DTOs
// Integration event types will be added here as modules need to communicate
// across boundaries. Domain event base lives in @nestjs-fastify-nx/core.
export { PaginationDto, PageMetaDto, PageDto } from './lib/dto/pagination.dto';
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
export { ERROR_CODES, errorTypeUrl, type ErrorCode } from './lib/errors/error-codes';
export {
  ApiCommonErrors,
  type CommonErrorsOptions,
} from './lib/swagger/api-common-errors.decorator';
export { ApiPaginatedResponse } from './lib/swagger/api-paginated-response.decorator';
