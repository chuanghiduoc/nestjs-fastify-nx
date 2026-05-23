import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import { ListResponseDto } from '../dto/list-response.dto';

// Composes allOf[ListResponseDto, { data: Item[] }] so codegen (Orval, openapi-typescript) emits a fully-typed response.
export const ApiPaginatedResponse = <TModel extends Type<unknown>>(
  model: TModel,
  options: { description?: string } = {},
) =>
  applyDecorators(
    ApiExtraModels(ListResponseDto, model),
    ApiOkResponse({
      description: options.description ?? `Paginated list of ${model.name}`,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ListResponseDto) },
          {
            type: 'object',
            properties: {
              data: { type: 'array', items: { $ref: getSchemaPath(model) } },
            },
          },
        ],
      },
    }),
  );
