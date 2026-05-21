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

export function toListResponse<T>(args: {
  url: string;
  items: readonly T[];
  page: number;
  pageSize: number;
  total: number;
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
