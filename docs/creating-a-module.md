# Creating a New Module

> Want to understand what each generated file is _for_ before you start? Read
> [`domain-module-anatomy.md`](./domain-module-anatomy.md) — it explains the tier
> ladder (leaf → engine → composition) and every file type with real examples
> from the `users` and `sessions` modules.

## Quick Start

```bash
pnpm gen:module products             # → libs/modules/src/products/ (folder in the group)
pnpm gen:composition billing-report  # → libs/composition/billing-report (Nx project)

# Equivalent raw generator:
pnpm nx g @nestjs-fastify-nx/tools-generators:module --name=products
```

`pnpm gen:module` scaffolds a **leaf-tier folder** inside the `libs/modules` group and wires the `./products` entry into `libs/modules/package.json`'s exports map. No project is created, nothing is installed, nothing is synced — the import `@nestjs-fastify-nx/modules/products` resolves immediately through the group package. The name must be kebab-case (e.g. `products`, `order-items`).

`pnpm gen:composition` scaffolds an orchestrator **project** under `libs/composition/` and runs `nx sync` + `pnpm install` (a new package needs its workspace symlink before it resolves).

To remove a folder module later: `pnpm rm:module products` (deletes the folder, drops the exports-map entry, prints leftover references). To remove a composition project: `pnpm rm:project composition-billing-report`.

Omit `--name` on the raw generator to be prompted interactively. Use `--directory=composition` when the module is a cross-cutting aggregate (default is `modules`).

## Generated Structure (leaf)

```
libs/modules/src/products/
├── products.module.ts                        # wires repository + handlers + controller
├── index.ts                                  # public barrel — commands/queries + result types, never handlers
├── products.controller.ts + .spec.ts          # HTTP surface, bus dispatch, bus-mock unit spec
├── products.dto.ts                            # presentation DTOs — class-validator here, @ApiProperty on responses
├── create-products.ts                        # colocated: CreateProductsCommand + @CommandHandler
├── list-products.ts                          # colocated: ListProductsQuery + @QueryHandler
├── products-repository.port.ts               # repository port + record type
├── prisma-products.repository.ts             # Prisma adapter against the `products` delegate
└── prisma-products.repository.integration.spec.ts   # Testcontainers spec, colocated with the adapter
```

The scaffold references the `products` Prisma delegate, so **add the Prisma model and migrate before the first typecheck** (`pnpm db:migrate --name add-products`). The integration spec is a real Testcontainers test of create / tenant-scoped find / keyset pagination — adapt its seed once the model's columns are final.

The import path `@nestjs-fastify-nx/modules/products` resolves through the group package's exports map — there is no `tsconfig` path alias and no per-context package. Typecheck, lint and test run on the **group project**: `pnpm nx run modules:typecheck`, `pnpm nx test modules` (the colocated unit specs) and `pnpm nx test modules -- integration` for the integration lane (`integration` is a vitest filename filter that matches only `*.integration.spec.ts`).

## Promoting a leaf to engine

When a context grows real invariants or listeners, promote it to the **engine tier**: add the DDD subfolders it actually needs inside the same context folder and move files into them. The engine tier **may** grow these folders — the tree below is the full menu, not a contract. Each engine owns a different subset of the optional folders: `upload` has `application/ports/` + `infrastructure/dispatchers/`, `users` has `domain/value-objects/`, and several engines have no `application/dto/`. The group project, exports map, barrel entry, and module wiring keep working — only import paths change.

```
libs/modules/src/products/
├── products.module.ts               # stays at the context root
├── products-listeners.module.ts     # optional listeners-only slice (worker/scheduler hosts)
├── index.ts                         # stays at the context root; exports point into subfolders
├── domain/
│   ├── entities/products.entity.ts (+ spec)
│   ├── value-objects/
│   └── ports/products-repository.port.ts
├── application/
│   ├── commands/create-products.ts            # Command + @CommandHandler, colocated
│   ├── queries/list-products.ts               # Query + @QueryHandler, colocated
│   ├── listeners/product-registered.listener.ts (+ spec)
│   ├── ports/                                 # outbound capabilities (queue dispatchers, …)
│   └── dto/                                   # shared pure-TS result types
├── infrastructure/
│   ├── repositories/prisma-products.repository.ts (+ colocated .integration.spec.ts)
│   └── dispatchers/
├── presentation/
│   ├── controllers/products.controller.ts (+ spec)
│   └── dto/products.dto.ts
└── testing/                         # in-memory repositories, factories
```

The generator does not scaffold the engine tier — promotion is a deliberate manual move (or `pnpm gen:module` a fresh leaf and port the code). Live examples: `libs/modules/src/users`, `libs/modules/src/organizations`, `libs/modules/src/upload` — each one keeps a different subset of the optional folders.

## Removing a module

```bash
pnpm rm:module products
```

Deletes `libs/modules/src/products/`, drops the `./products` exports-map entry, and greps `apps/` + `libs/` for leftover `@nestjs-fastify-nx/modules/products` references so nothing dangles. Finish with the affected gate.

## Composition Variant

Use `--directory=composition` for cross-cutting aggregates that orchestrate multiple bounded contexts
(e.g. an admin dashboard that reads from users, audit-log, and upload).

```bash
pnpm nx g @nestjs-fastify-nx/tools-generators:module --name=billing-report --directory=composition
```

This produces a presentation-only project under `libs/composition/billing-report/`:

- Project name: `composition-billing-report`
- Scope tag: `scope:composition`
- Import path: `@nestjs-fastify-nx/composition-billing-report`
- Owns `package.json`, `tsconfig.*`, `vitest.config.mts` — a real Nx project, unlike a folder module

**When to use composition vs modules:**

| Use `modules` (folder)                         | Use `composition` (project)                                  |
| ---------------------------------------------- | ------------------------------------------------------------ |
| Single bounded context (users, orders, upload) | Orchestrates 2+ bounded contexts                             |
| Owns its own Prisma model                      | Aggregates read-models from other modules                    |
| Other contexts must NOT import it              | Composition can depend on `scope:modules`; never the reverse |

Context-to-context edges inside the group are enforced by the `libs-groups/no-cross-context-imports` ESLint rule; scope-level edges by `@nx/enforce-module-boundaries`. If you find yourself needing a cross-context import inside `libs/modules/src/<ctxA>/`, extract a composition lib instead — or, when data must arrive reactively, a domain event through the outbox.

## Targets — group project vs composition project

A folder module has **no project and no targets of its own**. The single `modules` project owns `typecheck`, `lint`, and `test` for every context folder; its `vitest.config.mts` sets the aggregate coverage threshold and runs the integration lane. Nothing to edit, nothing to register.

A composition project's targets are inferred from its config files — `typecheck` (from `tsconfig.json`), `lint` (from the workspace ESLint config), and `test` (from `vitest.config.mts`). Libraries have no `build` target: the four apps bundle library source through webpack.

## Infrastructure & generic libraries

There is **no `gen:infra`** command — the folders under `libs/infra/src/` (`auth`, `authorization`,
`database`, `i18n`, `messaging`, `observability`, `redis`, `storage`) are technical adapters, not DDD
bounded contexts, so the DDD module generator doesn't apply (it only accepts
`--directory=modules|composition`). To add one:

- **Preferred:** copy the closest existing infra folder (e.g. `libs/infra/src/redis`) into a new
  folder, then add its `./<folder>` entry to the `exports` map in `libs/infra/package.json` — the
  single `infra` project already matches the workspace conventions (`defineVitestConfig` from
  `vitest.shared.ts`, `scope:infra` tag).
- `pnpm gen:lib` / `pnpm gen:app` are raw `@nx/js:library` / `@nx/nest:application` passthroughs.
  Their Nx-default output drifts from this repo (it emits an explicit `build` target and the
  deprecated `nxViteTsPaths`/`nxCopyAssetsPlugin` vite plugins), so align it afterwards: delete the
  explicit targets and replace the generated vitest config with `defineVitestConfig` from
  `vitest.shared.ts`. Also add the correct `scope:*` / `type:*` tags so
  `@nx/enforce-module-boundaries` applies.

Cross-folder imports inside `libs/infra/src/` are blocked by `libs-groups/no-cross-context-imports`
unless the edge is added to the group's documented DAG in `eslint.config.mjs`. Targets run on the
group project: `pnpm nx run infra:typecheck` and `pnpm nx test infra` (append `-- integration` for
the integration lane).

## After Generating

1. **Add Prisma model** to `prisma/schema.prisma` (the scaffold's port and adapter assume it)
2. **Run migration**: `pnpm db:migrate --name add-products`
3. **Adapt the record type**: adjust `products-repository.port.ts` and the adapter's `create`/`find` shapes to the real columns
4. **Add permissions** if the surface is tenant-facing: declare them in `@nestjs-fastify-nx/shared` and decorate the controller with `@RequirePermission()`
5. **Wire into AppModule**: add `ProductsModule` to `apps/api/src/app/app.module.ts`
6. **Run tests**: `pnpm nx test modules`

## Example: Domain Entity with Business Rules

Throw `DomainException` (from `@nestjs-fastify-nx/core`) for domain violations — the global
filter renders them as RFC 9457 Problem Details so the frontend handles schema and business failures
through one rendering path.

```typescript
import { generateId } from '@nestjs-fastify-nx/shared';
import { DomainException } from '@nestjs-fastify-nx/core';

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
      throw new DomainException({
        // kind defaults to 'validation' → 422; permanent defaults to true.
        violations: [
          {
            path: 'price',
            code: 'out_of_range',
            message: 'price must be >= 0',
            constraint: { min: 0 },
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

**Register handlers**: add each `@QueryHandler`/`@CommandHandler` to the module's `providers` array (they do not need to be exported). The `CqrsModule.forRoot()` explorer in each runnable app (`api`, `worker`, `scheduler`) and the `codegen-app` module used for spec export discovers them across all loaded modules — no manual bus registration.

## Testing Pattern

- **Unit tests**: colocated `*.spec.ts` next to the unit under test — controller specs mock the buses, handler specs use the context's in-memory repository (add one when a handler needs it)
- **Integration tests**: the colocated `prisma-<ctx>.repository.integration.spec.ts` uses Testcontainers via `@nestjs-fastify-nx/testing` (real Postgres) — database tests never mock Prisma
- **E2E tests**: add spec at `apps/api/e2e/products.e2e-spec.ts` — assert on the resource directly
  (`res.body.id`), and on `application/problem+json` for error paths (`res.body.code`, `res.body.errors[]`)

```bash
pnpm nx test modules                # group unit lane (every context folder)
pnpm nx test modules -- integration # group integration lane (requires Docker)
pnpm nx run api:e2e                 # e2e (requires Docker)
```
