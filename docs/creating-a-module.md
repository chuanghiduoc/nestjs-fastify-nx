# Creating a New Module

## Quick Start

```bash
pnpm nx g @nestjs-fastify-nx/tools-generators:module --name=products
```

The generator creates `libs/modules/products/` with full DDD layers.

## Generated Structure

```
libs/modules/products/src/
  domain/
    entities/products.entity.ts
    value-objects/
    events/products-created.event.ts
    ports/products-repository.port.ts
  application/
    commands/create-products/
      create-products.command.ts
      create-products.handler.ts
    queries/
  infrastructure/
    repositories/prisma-products.repository.ts
  presentation/
    controllers/products.controller.ts
    dto/
  products.module.ts
  index.ts
```

## After Generating

1. **Add Prisma model** to `prisma/schema.prisma`
2. **Run migration**: `pnpm prisma migrate dev --name add-products`
3. **Implement domain entity** with business rules
4. **Implement repository adapter** in `infrastructure/repositories/`
5. **Wire into AppModule**: add `ProductsModule` to `apps/api/src/app/app.module.ts`

## Example: Minimal Domain Entity

Throw `BusinessRuleException` (from `@nestjs-fastify-nx/core`) for domain
violations — the global filter renders them as RFC 9457 Problem Details with a
flat `errors[]` payload, so the frontend treats schema and business failures
through one rendering path.

```typescript
import { BusinessRuleException } from '@nestjs-fastify-nx/core';

export class Product {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly price: number,
  ) {}

  static create(name: string, price: number): Product {
    if (price < 0) {
      throw new BusinessRuleException({
        violations: [
          {
            path: 'price',
            code: 'out_of_range',
            message: 'price must be greater than or equal to 0',
            constraint: { min: 0 },
            received: price,
          },
        ],
      });
    }
    return new Product(generateId(), name, price);
  }
}
```

## Example: Controller wiring

Apply `@ApiCommonErrors` for the error envelope and `@ApiPaginatedResponse`
when returning a list — both from `@nestjs-fastify-nx/contracts`.

```typescript
import { ApiCommonErrors, ApiPaginatedResponse } from '@nestjs-fastify-nx/contracts';

@Controller('products')
@ApiTags('products')
export class ProductsController {
  @Get()
  @ApiPaginatedResponse(ProductResponseDto)
  @ApiCommonErrors({ auth: true, validation: true })
  list(@Query() query: ListProductsDto) { … }

  @Post()
  @ApiCreatedResponse({ type: ProductResponseDto })
  @ApiCommonErrors({ auth: true, validation: true, conflict: true })
  create(@Body() dto: CreateProductDto) { … }
}
```

`ProblemDetailsValidationPipe` is wired globally — no extra setup needed for
422 validation envelopes.

## Testing Pattern

- Unit tests: use mock ports from `libs/modules/products/src/testing/`
- Integration tests: use Testcontainers via `@nestjs-fastify-nx/testing`
- E2E tests: add spec in `apps/api/e2e/products.e2e-spec.ts` — assert on the
  resource directly (`res.body.id`), and on `application/problem+json` for
  error paths (`res.body.code`, `res.body.errors[]`).
