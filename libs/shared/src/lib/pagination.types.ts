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

export function paginationSkip(options: PaginationOptions): number {
  return (options.page - 1) * options.pageSize;
}
