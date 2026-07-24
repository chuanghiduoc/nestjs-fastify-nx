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
  // Clamp the divisor, not just the result: a pageSize of 0 would make total/pageSize === Infinity,
  // which Math.max(1, …) cannot rescue and leaves hasNextPage stuck true (mirrors toListResponse).
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasPrevPage: page > 1,
    hasNextPage: page < totalPages,
  };
}

// PaginationDto's @Min(1) only guards the HTTP path; a direct caller could otherwise hand Prisma a
// negative skip, which it rejects with an error naming the driver rather than the bad page.
export function paginationSkip(options: PaginationOptions): number {
  const page = Number.isFinite(options.page) ? Math.max(1, Math.trunc(options.page)) : 1;
  const pageSize = Number.isFinite(options.pageSize)
    ? Math.max(0, Math.trunc(options.pageSize))
    : 0;
  return (page - 1) * pageSize;
}
