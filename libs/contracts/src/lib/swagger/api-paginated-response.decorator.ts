import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import { ListResponseDto } from '../dto/list-response.dto';

/**
 * Documents a list endpoint as returning a Stripe-style `ListResponseDto<Item>`
 * with the `data` field typed as `Item[]`.
 *
 * Generic schemas are not directly representable in OpenAPI — this composes an
 * `allOf: [ListResponseDto, { properties: { data: { type: 'array', items: $ref(Item) } } }]`
 * so codegen tools (Orval, openapi-typescript) emit a fully-typed response.
 *
 * @example
 * ```ts
 * @Get()
 * @ApiPaginatedResponse(UserDto, { description: 'Page of users' })
 * list(@Query() filter: ListUsersFilterDto): Promise<ListResponseDto<UserDto>> {
 *   ...
 * }
 * ```
 */
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
