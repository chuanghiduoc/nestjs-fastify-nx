// contracts public API — integration event schemas, cross-module DTOs
// Integration event types will be added here as modules need to communicate
// across boundaries. Domain event base lives in @nestjs-fastify-nx/core.
export { PaginationDto, PageMetaDto, PageDto } from './lib/dto/pagination.dto';
