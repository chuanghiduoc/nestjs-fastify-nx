export interface PaginationOptions {
  readonly page: number;
  readonly pageSize: number;
}

export interface PageMeta {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
  readonly hasPrevPage: boolean;
  readonly hasNextPage: boolean;
}

export interface Page<T> {
  readonly data: readonly T[];
  readonly meta: PageMeta;
}

export function buildPageMeta(page: number, pageSize: number, total: number): PageMeta {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasPrevPage: page > 1,
    hasNextPage: page < totalPages,
  };
}

// Clamped, as libs/shared/README.md promises. PaginationDto's @Min(1) only guards the HTTP path —
// a service, queue consumer, or test calling this directly could otherwise produce a negative skip,
// which Prisma rejects at the driver with an error that says nothing about which page caused it.
export function paginationSkip(options: PaginationOptions): number {
  const page = Number.isFinite(options.page) ? Math.max(1, Math.trunc(options.page)) : 1;
  const pageSize = Number.isFinite(options.pageSize)
    ? Math.max(0, Math.trunc(options.pageSize))
    : 0;
  return (page - 1) * pageSize;
}
