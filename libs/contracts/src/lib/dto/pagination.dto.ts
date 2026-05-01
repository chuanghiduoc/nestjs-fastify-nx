import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  buildPageMeta,
  type Page,
  type PageMeta,
  type PaginationOptions,
} from '@nestjs-fastify-nx/shared';

export class PaginationDto implements PaginationOptions {
  @ApiPropertyOptional({
    type: Number,
    description: 'Page number (1-based)',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({
    type: Number,
    description: 'Items per page',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  get skip(): number {
    return (this.page - 1) * this.pageSize;
  }
}

export class PageMetaDto implements PageMeta {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 5 })
  totalPages: number;

  @ApiProperty({ example: true })
  hasPrevPage: boolean;

  @ApiProperty({ example: false })
  hasNextPage: boolean;

  constructor(page: number, pageSize: number, total: number) {
    const meta = buildPageMeta(page, pageSize, total);
    this.page = meta.page;
    this.pageSize = meta.pageSize;
    this.total = meta.total;
    this.totalPages = meta.totalPages;
    this.hasPrevPage = meta.hasPrevPage;
    this.hasNextPage = meta.hasNextPage;
  }
}

export class PageDto<T> implements Page<T> {
  @ApiProperty({ isArray: true })
  data: T[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;

  constructor(data: T[], page: number, pageSize: number, total: number) {
    this.data = data;
    this.meta = new PageMetaDto(page, pageSize, total);
  }
}
