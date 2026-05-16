/// <reference types="vitest/globals" />
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { readProjectConfiguration, readJson } from '@nx/devkit';
import type { Tree } from '@nx/devkit';
import { moduleGenerator } from './generator';

describe('module generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    if (!tree.exists('tsconfig.base.json')) {
      tree.write('tsconfig.base.json', JSON.stringify({ compilerOptions: { paths: {} } }, null, 2));
    }
  });

  it('creates project configuration with scope:modules and type:feature tags', async () => {
    await moduleGenerator(tree, { name: 'orders', directory: 'modules', withCqrs: true });

    const config = readProjectConfiguration(tree, 'modules-orders');
    expect(config.root).toBe('libs/modules/orders');
    expect(config.tags).toContain('scope:modules');
    expect(config.tags).toContain('type:feature');
    expect(config.tags).not.toContain('module:orders');
    expect(config.targets?.['test']?.executor).toBe('@nx/vitest:test');
  });

  it('emits tsconfig and vitest config so build/typecheck targets are inferred', async () => {
    await moduleGenerator(tree, { name: 'orders', directory: 'modules', withCqrs: false });

    expect(tree.exists('libs/modules/orders/tsconfig.json')).toBe(true);
    expect(tree.exists('libs/modules/orders/tsconfig.lib.json')).toBe(true);
    expect(tree.exists('libs/modules/orders/tsconfig.spec.json')).toBe(true);
    expect(tree.exists('libs/modules/orders/vitest.config.mts')).toBe(true);
  });

  it('generates full DDD domain layer', async () => {
    await moduleGenerator(tree, { name: 'products', directory: 'modules', withCqrs: false });

    expect(tree.exists('libs/modules/products/src/domain/entities/products.entity.ts')).toBe(true);
    expect(tree.exists('libs/modules/products/src/domain/entities/products.entity.spec.ts')).toBe(
      true,
    );
    expect(tree.exists('libs/modules/products/src/domain/value-objects/.gitkeep')).toBe(true);
    expect(tree.exists('libs/modules/products/src/domain/events/products-created.event.ts')).toBe(
      true,
    );
    expect(tree.exists('libs/modules/products/src/domain/ports/products-repository.port.ts')).toBe(
      true,
    );
  });

  it('generates full DDD application layer placeholders', async () => {
    await moduleGenerator(tree, { name: 'products', directory: 'modules', withCqrs: false });

    expect(tree.exists('libs/modules/products/src/application/queries/.gitkeep')).toBe(true);
    expect(tree.exists('libs/modules/products/src/application/listeners/.gitkeep')).toBe(true);
    expect(tree.exists('libs/modules/products/src/application/dtos/.gitkeep')).toBe(true);
  });

  it('generates infrastructure repository', async () => {
    await moduleGenerator(tree, { name: 'products', directory: 'modules', withCqrs: false });

    expect(
      tree.exists(
        'libs/modules/products/src/infrastructure/repositories/prisma-products.repository.ts',
      ),
    ).toBe(true);
  });

  it('generates presentation layer with dto placeholder', async () => {
    await moduleGenerator(tree, { name: 'products', directory: 'modules', withCqrs: false });

    expect(
      tree.exists('libs/modules/products/src/presentation/controllers/products.controller.ts'),
    ).toBe(true);
    expect(
      tree.exists('libs/modules/products/src/presentation/controllers/products.controller.spec.ts'),
    ).toBe(true);
    expect(tree.exists('libs/modules/products/src/presentation/dto/.gitkeep')).toBe(true);
  });

  it('generates testing layer (factory + mock repository)', async () => {
    await moduleGenerator(tree, { name: 'products', directory: 'modules', withCqrs: false });

    expect(tree.exists('libs/modules/products/src/testing/products.factory.ts')).toBe(true);
    expect(tree.exists('libs/modules/products/src/testing/mock-products-repository.ts')).toBe(true);
  });

  it('emitted files contain zero TODO or FIXME', async () => {
    await moduleGenerator(tree, { name: 'products', directory: 'modules', withCqrs: true });

    const filesToCheck = [
      'libs/modules/products/src/infrastructure/repositories/prisma-products.repository.ts',
      'libs/modules/products/src/presentation/controllers/products.controller.ts',
      'libs/modules/products/src/products.module.ts',
      'libs/modules/products/src/domain/entities/products.entity.ts',
    ];

    for (const file of filesToCheck) {
      const content = tree.read(file, 'utf-8') ?? '';
      expect(content, `${file} contains TODO`).not.toMatch(/\bTODO\b/);
      expect(content, `${file} contains FIXME`).not.toMatch(/\bFIXME\b/);
    }
  });

  it('adds path alias to tsconfig.base.json', async () => {
    await moduleGenerator(tree, { name: 'invoices', directory: 'modules', withCqrs: false });

    const tsconfig = readJson(tree, 'tsconfig.base.json');
    expect(tsconfig.compilerOptions.paths['@nestjs-fastify-nx/modules-invoices']).toEqual([
      './libs/modules/invoices/src/index.ts',
    ]);
  });

  it('generates cqrs command files when withCqrs=true', async () => {
    await moduleGenerator(tree, { name: 'tasks', directory: 'modules', withCqrs: true });

    expect(
      tree.exists(
        'libs/modules/tasks/src/application/commands/create-tasks/create-tasks.command.ts',
      ),
    ).toBe(true);
    expect(
      tree.exists(
        'libs/modules/tasks/src/application/commands/create-tasks/create-tasks.handler.ts',
      ),
    ).toBe(true);
  });

  it('emits controller with correct route segment (no pluralisation)', async () => {
    await moduleGenerator(tree, { name: 'users', directory: 'modules', withCqrs: false });

    const controller = tree.read(
      'libs/modules/users/src/presentation/controllers/users.controller.ts',
      'utf-8',
    );
    expect(controller).toContain("@Controller('users')");
    expect(controller).not.toContain("@Controller('userss')");
  });

  it('places module under libs/composition with correct project name and scope tag when directory=composition', async () => {
    await moduleGenerator(tree, { name: 'admin', directory: 'composition', withCqrs: false });

    const config = readProjectConfiguration(tree, 'composition-admin');
    expect(config.root).toBe('libs/composition/admin');
    expect(config.tags).toContain('scope:composition');
    expect(config.tags).not.toContain('scope:modules');
    expect(config.tags).toContain('type:feature');
    expect(tree.exists('libs/composition/admin/src/admin.module.ts')).toBe(true);
  });

  it('composition module tsconfig path uses composition- prefix', async () => {
    await moduleGenerator(tree, { name: 'billing', directory: 'composition', withCqrs: false });

    const tsconfig = readJson(tree, 'tsconfig.base.json');
    expect(tsconfig.compilerOptions.paths['@nestjs-fastify-nx/composition-billing']).toEqual([
      './libs/composition/billing/src/index.ts',
    ]);
    expect(tsconfig.compilerOptions.paths['@nestjs-fastify-nx/modules-billing']).toBeUndefined();
  });

  it('modules module gets scope:modules tag (boundary integrity)', async () => {
    await moduleGenerator(tree, { name: 'orders', directory: 'modules', withCqrs: false });

    const config = readProjectConfiguration(tree, 'modules-orders');
    expect(config.tags).toContain('scope:modules');
    expect(config.tags).not.toContain('scope:composition');
  });

  describe('directory normalization — backward compat full paths', () => {
    it('accepts "libs/modules" as equivalent to "modules"', async () => {
      await moduleGenerator(tree, { name: 'payments', directory: 'libs/modules', withCqrs: false });

      const config = readProjectConfiguration(tree, 'modules-payments');
      expect(config.root).toBe('libs/modules/payments');
      expect(config.tags).toContain('scope:modules');
    });

    it('accepts "libs/composition" as equivalent to "composition"', async () => {
      await moduleGenerator(tree, {
        name: 'reports',
        directory: 'libs/composition',
        withCqrs: false,
      });

      const config = readProjectConfiguration(tree, 'composition-reports');
      expect(config.root).toBe('libs/composition/reports');
      expect(config.tags).toContain('scope:composition');
    });

    it('throws for an unrecognized directory value', async () => {
      await expect(
        moduleGenerator(tree, { name: 'bad', directory: 'libs/other', withCqrs: false }),
      ).rejects.toThrow(/Invalid --directory/);
    });

    it('throws for a raw path with slashes that does not match known scopes', async () => {
      await expect(
        moduleGenerator(tree, { name: 'bad', directory: 'src/something', withCqrs: false }),
      ).rejects.toThrow(/Invalid --directory/);
    });
  });
});
