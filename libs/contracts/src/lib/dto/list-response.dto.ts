import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// Stripe-style list envelope. data is unknown[] so @ApiExtraModels registration works once.
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

  // Explicit array schema. Without `type`, a generic `T[]` erases to `Array` at runtime (no swagger
  // SWC/CLI plugin is configured) and swagger nests it into an array-of-array. `items: {}` keeps the
  // base envelope's items open (`unknown[]`); ApiPaginatedResponse's allOf refines them per endpoint.
  @ApiProperty({
    description:
      'Items in the current page. Order is endpoint-defined and stable for cursor pagination.',
    type: 'array',
    items: {},
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
      'Opaque cursor pointing at the last item in `data` — pass back as `startingAfter` to fetch the next page. Present only on cursor-paginated endpoints; null when the result set is empty. Format is `base64url(sortField.toISOString():id)` — clients MUST treat it as opaque. The cursor encodes ONLY the sort position; it does NOT remember filter parameters (`role`, `status`, `search`, etc.). Changing any filter between page requests is equivalent to a fresh first-page query starting at the encoded position — clients changing filters mid-pagination should drop the cursor and restart.',
    // Explicit `type: String`: the `string | null` union erases to `Object`, so without this swagger
    // documents this base64url cursor as an arbitrary object map (breaking `startingAfter` typing).
    type: String,
    example: 'MjAyNi0wNS0xOVQwMzowNTowMC4wMDBaOjAxOTczMmRiLTYwMTAtN2Y3Zi1iNDY0LTBkMjBjNWUzYThmOQ',
    nullable: true,
  })
  lastCursor?: string | null;

  @ApiPropertyOptional({
    description:
      'Total matching rows. Omitted (undefined) on large/growth tables where COUNT would be a hot path — clients navigate via `hasMore`, not this.',
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
}

export function toListResponse<T>(args: {
  url: string;
  items: readonly T[];
  page: number;
  pageSize: number;
  total: number;
  includeTotal?: boolean;
}): ListResponseDto<T> {
  const includeTotal = args.includeTotal ?? true;
  // Clamp pageSize: @Min(1) only guards the HTTP boundary, and pageSize=0 here yields Infinity,
  // which would leave hasMore permanently true.
  const lastPage = Math.max(1, Math.ceil(args.total / Math.max(1, args.pageSize)));
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

export function toCursorListResponse<T>(args: {
  url: string;
  items: readonly T[];
  hasMore: boolean;
  lastCursor: string | null;
}): ListResponseDto<T> {
  const response = new ListResponseDto<T>();
  response.url = args.url;
  response.data = [...args.items];
  response.hasMore = args.hasMore;
  response.lastCursor = args.lastCursor;
  return response;
}
