import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import { applyDecorators } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { ListResponseDto } from '../dto/list-response.dto';

export function ApiUnpaginatedListResponse<TModel extends Type<unknown>>(
  model: TModel,
  options?: { description?: string },
) {
  return applyDecorators(
    ApiExtraModels(ListResponseDto, model),
    ApiOkResponse({
      ...(options?.description ? { description: options.description } : {}),
      schema: {
        allOf: [
          { $ref: getSchemaPath(ListResponseDto) },
          {
            properties: {
              data: { type: 'array', items: { $ref: getSchemaPath(model) } },
              hasMore: { type: 'boolean', enum: [false] },
            },
          },
        ],
      },
    }),
  );
}
