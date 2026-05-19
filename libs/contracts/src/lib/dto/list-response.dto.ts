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
      'True when more items follow the last element. Use `lastCursor` as `startingAfter` to fetch the next page on cursor-paginated endpoints.',
    example: true,
  })
  hasMore!: boolean;

  @ApiPropertyOptional({
    description:
      'Opaque cursor pointing at the last item in `data` — pass back as `startingAfter` to fetch the next page. Present only on cursor-paginated endpoints; null when the result set is empty. Format is `base64url(sortField.toISOString():id)` — clients MUST treat it as opaque.',
    example: 'MjAyNi0wNS0xOVQwMzowNTowMC4wMDBaOjAxOTczMmRiLTYwMTAtN2Y3Zi1iNDY0LTBkMjBjNWUzYThmOQ',
    nullable: true,
  })
  lastCursor?: string | null;

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
 * `startingAfter` / `endingBefore` are mutually exclusive opaque cursors
 * (base64url(`sortField.toISOString():id`)) copied verbatim from a previous
 * response's `lastCursor`. Clients MUST NOT construct or decode them.
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
    description:
      "Opaque cursor for the next page — pass the previous response's `lastCursor` value verbatim. The encoded format is `base64url(sortField.toISOString():id)` and clients MUST NOT construct it manually.",
    example: 'MjAyNi0wNS0xOVQwMzowNTowMC4wMDBaOjAxOTczMmRiLTYwMTAtN2Y3Zi1iNDY0LTBkMjBjNWUzYThmOQ',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  startingAfter?: string;

  @ApiPropertyOptional({
    description:
      "Opaque cursor for the previous page — pass the first item's cursor from the current response. Same opaque format as `startingAfter`.",
    example: 'MjAyNi0wNS0xOVQwMzowMDowMC4wMDBaOjAxOTczMmRiLTYwMTAtN2Y3Zi1iNDY0LTBkMjBjNWUzYThmOQ',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
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
  /** Opaque continuation cursor — handler should pass `encodeCursor(sortField, id)` of the last item, or null when the page is empty. */
  lastCursor: string | null;
}): ListResponseDto<T> {
  const response = new ListResponseDto<T>();
  response.url = args.url;
  response.data = [...args.items];
  response.hasMore = args.hasMore;
  response.lastCursor = args.lastCursor;
  return response;
}
