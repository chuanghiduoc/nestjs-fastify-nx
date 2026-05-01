import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Stripe / Linear-style list envelope for collection endpoints.
 *
 * Cursor-based pagination is preferred (`startingAfter`, `endingBefore`) — it
 * is stable under concurrent inserts/deletes and avoids OFFSET scans. Offset
 * fields (`page`, `pageSize`, `totalCount`) are optional add-ons for admin /
 * dashboard endpoints that need "Page 5 / 127" UX. Only one paradigm should
 * be exposed per endpoint; mixing them confuses consumers.
 *
 * `data` is `unknown[]` here so the class can be `@ApiExtraModels`-registered
 * once. Endpoint-specific `@ApiPaginatedResponse(ItemDto)` overrides
 * `data: { type: 'array', items: $ref(ItemDto) }` in the generated schema.
 */
export class ListResponseDto<T = unknown> {
  @ApiProperty({
    description: 'Discriminator value identifying this envelope as a list.',
    enum: ['list'],
    example: 'list',
  })
  object = 'list' as const;

  @ApiProperty({
    description: 'Endpoint URL (without query string) — useful for SDK base path inference.',
    example: '/api/v1/admin/users',
  })
  url!: string;

  @ApiProperty({
    description:
      'Items in the current page. Order is endpoint-defined and stable for cursor pagination.',
    isArray: true,
  })
  data!: T[];

  @ApiProperty({
    description:
      "True when more items follow the last element. Use the last element's `id` as `startingAfter` to fetch the next page.",
    example: true,
  })
  hasMore!: boolean;

  @ApiPropertyOptional({
    description:
      'Total matching rows. Only present when `?withTotalCount=true` is requested (COUNT is expensive on large tables).',
    example: 1284,
  })
  totalCount?: number;

  @ApiPropertyOptional({
    description: 'Current page (1-based). Present only on offset-paginated endpoints.',
    example: 3,
  })
  page?: number;

  @ApiPropertyOptional({
    description: 'Items per page. Present only on offset-paginated endpoints.',
    example: 20,
  })
  pageSize?: number;
}

/**
 * Cursor pagination query params (preferred). `limit` is the soft page size;
 * `startingAfter`/`endingBefore` are mutually exclusive item IDs.
 */
export class CursorPaginationDto {
  @ApiPropertyOptional({
    type: Number,
    description: 'Items per page (1–100).',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({
    description: "Cursor for the next page — pass the last item's `id` from the previous response.",
    example: 'usr_01HXY7K3MN8P2RZ4QW9TB6FH3D',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  startingAfter?: string;

  @ApiPropertyOptional({
    description:
      "Cursor for the previous page — pass the first item's `id` from the current response.",
    example: 'usr_01HXY1A3MN8P2RZ4QW9TB6FH3D',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  endingBefore?: string;
}

/**
 * Build a Stripe-style list envelope from page-paginated handler output.
 * Use this at the controller boundary to translate domain `Page<T>` into the
 * public response shape.
 */
export function toListResponse<T>(args: {
  url: string;
  items: readonly T[];
  page: number;
  pageSize: number;
  total: number;
  /** Set true when client opted into the COUNT cost. Defaults to true to preserve current behavior. */
  includeTotal?: boolean;
}): ListResponseDto<T> {
  const includeTotal = args.includeTotal ?? true;
  const lastPage = Math.max(1, Math.ceil(args.total / args.pageSize));
  const response = new ListResponseDto<T>();
  response.url = args.url;
  response.data = [...args.items];
  response.hasMore = args.page < lastPage;
  response.page = args.page;
  response.pageSize = args.pageSize;
  if (includeTotal) {
    response.totalCount = args.total;
  }
  return response;
}

/**
 * Build a Stripe-style list envelope from cursor-paginated handler output.
 * Handler should fetch `limit + 1` rows and pass `hasMore` based on whether
 * the extra row was returned.
 */
export function toCursorListResponse<T>(args: {
  url: string;
  items: readonly T[];
  hasMore: boolean;
}): ListResponseDto<T> {
  const response = new ListResponseDto<T>();
  response.url = args.url;
  response.data = [...args.items];
  response.hasMore = args.hasMore;
  return response;
}
