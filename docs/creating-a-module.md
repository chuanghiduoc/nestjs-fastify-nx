# Creating a New Module

> Want to understand what each generated file is _for_ before you start? Read
> [`domain-module-anatomy.md`](./domain-module-anatomy.md) — it explains every
> file type (entity, value object, port, command/query handler, repository,
> controller, DTOs, module, barrel) with real examples from the `users` module.

## Quick Start

```bash
pnpm gen:module products             # shortcut → libs/modules/products (+ nx sync)
pnpm gen:composition billing-report  # shortcut → libs/composition/billing-report

# Equivalent raw generator:
pnpm nx g @nestjs-fastify-nx/tools-generators:module --name=products
```

`pnpm gen:module` / `pnpm gen:composition` wrap the generator and run `nx sync` for you (see `scripts/gen-module.sh`). The name must be kebab-case (e.g. `products`, `order-items`). To remove a module later: `pnpm rm:project modules-products`.

Omit `--name` on the raw generator to be prompted interactively. Use `--directory=composition` when the module is a cross-cutting aggregate (default is `modules`).

## Generated Structure

```
libs/modules/products/
├── src/
│   ├── domain/
│   │   ├── entities/
│   │   │   ├── products.entity.ts
│   │   │   └── products.entity.spec.ts
│   │   ├── value-objects/          # add VOs here as needed
│   │   ├── events/
│   │   │   └── products-created.event.ts
│   │   ├── ports/
│   │   │   └── products-repository.port.ts
│   │   └── index.ts
│   ├── application/
│   │   ├── commands/
│   │   │   └── create-products/    # (withCqrs=true, default)
│   │   │       ├── create-products.command.ts
│   │   │       └── create-products.handler.ts
│   │   ├── queries/                # add query handlers here
│   │   ├── listeners/              # add domain-event listeners here
│   │   ├── dtos/                   # application-layer DTOs
│   │   └── index.ts
│   ├── infrastructure/
│   │   ├── repositories/
│   │   │   └── prisma-products.repository.ts
│   │   └── index.ts
│   ├── presentation/
│   │   ├── controllers/
│   │   │   ├── products.controller.ts
│   │   │   └── products.controller.spec.ts
│   │   ├── dto/                    # request/response DTOs
│   │   └── index.ts
│   ├── testing/
│   │   ├── products.factory.ts     # in-memory test data builder
│   │   └── mock-products-repository.ts
│   ├── products.module.ts
│   └── index.ts                   # public barrel — export only what consumers need
├── tsconfig.json
├── tsconfig.lib.json
├── tsconfig.spec.json
└── vitest.config.mts
```

Path alias `@nestjs-fastify-nx/modules-products` is wired into `tsconfig.base.json` automatically.

## Composition Variant

Use `--directory=composition` for cross-cutting aggregates that orchestrate multiple bounded contexts
(e.g. an admin dashboard that reads from users, audit-log, and upload).

```bash
pnpm nx g @nestjs-fastify-nx/tools-generators:module --name=billing-report --directory=composition
```

This produces the same DDD layout under `libs/composition/billing-report/` with two differences:

- Project name: `composition-billing-report` (not `modules-billing-report`)
- Scope tag: `scope:composition` (not `scope:modules`)
- Path alias: `@nestjs-fastify-nx/composition-billing-report`

**When to use composition vs modules:**

| Use `modules`                                  | Use `composition`                                            |
| ---------------------------------------------- | ------------------------------------------------------------ |
| Single bounded context (users, orders, upload) | Orchestrates 2+ bounded contexts                             |
| Owns its own Prisma model                      | Aggregates read-models from other modules                    |
| Other modules must NOT import it               | Composition can depend on `scope:modules`; never the reverse |

The `@nx/enforce-module-boundaries` rule enforces this: `scope:modules` libs cannot import from each
other, but `scope:composition` can import from `scope:modules`. If you find yourself needing
cross-module imports inside a `scope:modules` lib, extract a composition lib instead.

## Targets are inferred — no config to edit

The generator writes **no explicit targets** into `project.json`. `build`/`typecheck` (from
`tsconfig.lib.json`), `lint` (from the workspace ESLint config), and `test` (from
`vitest.config.mts`) are all inferred by the workspace Nx plugins. A freshly generated module is
picked up automatically — you never hand-edit `nx.json` or add a `test` target. Run `nx test <name>`,
`nx lint <name>`, etc. immediately.

## Infrastructure & generic libraries

There is **no `gen:infra`** command — `libs/infra/*` are technical adapters (auth, database, redis,
storage…), not DDD bounded contexts, so the DDD module generator doesn't apply (it only accepts
`--directory=modules|composition`). To add one:

- **Preferred:** copy the closest existing infra lib (e.g. `libs/infra/redis`) and rename — it already
  matches the workspace conventions (inferred targets, `resolve: { tsconfigPaths: true }` in the
  vitest config, `scope:infra` tag).
- `pnpm gen:lib` / `pnpm gen:app` are raw `@nx/js:library` / `@nx/nest:application` passthroughs.
  Their Nx-default output drifts from this repo (it emits an explicit `build` target and the
  deprecated `nxViteTsPaths`/`nxCopyAssetsPlugin` vite plugins), so align it afterwards: delete the
  explicit targets and switch the vitest config to `resolve: { tsconfigPaths: true }`. Also add the correct
  `scope:*` / `type:*` tags so `@nx/enforce-module-boundaries` applies.

## After Generating

1. **Add Prisma model** to `prisma/schema.prisma`
2. **Run migration**: `pnpm prisma migrate dev --name add-products`
3. **Implement repository**: replace `NotImplementedException` stubs in `prisma-products.repository.ts`
4. **Expand entity** with domain properties and business rules
5. **Wire into AppModule**: add `ProductsModule` to `apps/api/src/app/app.module.ts`
6. **Run tests**: `pnpm nx test modules-products`

## Example: Domain Entity with Business Rules

Throw `BusinessRuleException` (from `@nestjs-fastify-nx/core`) for domain violations — the global
filter renders them as RFC 9457 Problem Details so the frontend handles schema and business failures
through one rendering path.

```typescript
import { generateId } from '@nestjs-fastify-nx/shared';
import { BusinessRuleException } from '@nestjs-fastify-nx/core';

export class Product {
  private constructor(
    readonly id: string,
    readonly name: string,
    readonly price: number,
    readonly createdAt: Date,
    readonly updatedAt: Date,
  ) {}

  static create(name: string, price: number): Product {
    if (price < 0) {
      throw new BusinessRuleException({
        violations: [
          {
            path: 'price',
            code: 'out_of_range',
            message: 'price must be >= 0',
            constraint: { min: 0 },
            received: price,
          },
        ],
      });
    }
    return new Product(generateId(), name, price, new Date(), new Date());
  }

  static reconstitute(raw: {
    id: string;
    name: string;
    price: number;
    createdAt: Date;
    updatedAt: Date;
  }): Product {
    return new Product(raw.id, raw.name, raw.price, raw.createdAt, raw.updatedAt);
  }
}
```

## Example: Controller Wiring

Apply `@ApiCommonErrors` for the error envelope and `@ApiPaginatedResponse` when returning a list —
both from `@nestjs-fastify-nx/contracts`.

```typescript
import { ApiCommonErrors, ApiPaginatedResponse } from '@nestjs-fastify-nx/contracts';
import { ApiTags } from '@nestjs/swagger';
import { CommandBus, QueryBus } from '@nestjs/cqrs';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  // Inject the buses, never the handlers — CqrsModule.forRoot() registers handlers globally.
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
  ) {}

  @Get()
  @ApiPaginatedResponse(ProductResponseDto)
  @ApiCommonErrors({ auth: true, validation: true })
  list(@Query() query: ListProductsDto) {
    return this.queryBus.execute(new ListProductsQuery(query.limit, query.startingAfter));
  }

  @Post()
  @ApiCreatedResponse({ type: ProductResponseDto })
  @ApiCommonErrors({ auth: true, validation: true, conflict: true })
  create(@Body() dto: CreateProductDto) {
    return this.commandBus.execute(new CreateProductCommand(dto.name, dto.price));
  }
}
```

`ProblemDetailsValidationPipe` is wired globally — no extra setup needed for 422 validation envelopes.

**Register handlers**: add each `@QueryHandler`/`@CommandHandler` to the module's `providers` array (they do not need to be exported). The `CqrsModule.forRoot()` explorer in each runnable app (`api`, `scheduler`, `codegen-app`) discovers them across all loaded modules — no manual bus registration.

## Testing Pattern

- **Unit tests**: inject `MockProductsRepository` from `libs/modules/products/src/testing/`
- **Integration tests**: use Testcontainers via `@nestjs-fastify-nx/testing` (real Postgres)
- **E2E tests**: add spec at `apps/api/e2e/products.e2e-spec.ts` — assert on the resource directly
  (`res.body.id`), and on `application/problem+json` for error paths (`res.body.code`, `res.body.errors[]`)

```bash
pnpm nx test modules-products          # unit
pnpm nx run api:e2e                    # e2e (requires Docker)
```
