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

```typescript
export class Product {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly price: number,
  ) {}

  static create(name: string, price: number): Product {
    if (price < 0) throw new BadRequestException('Price must be non-negative');
    return new Product(generateId(), name, price);
  }
}
```

## Testing Pattern

- Unit tests: use mock ports from `libs/modules/products/src/testing/`
- Integration tests: use Testcontainers via `@nestjs-fastify-nx/testing`
- E2E tests: add spec in `apps/api/e2e/products.e2e-spec.ts`
