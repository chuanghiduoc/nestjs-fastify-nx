import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { readProjectConfiguration, readJson } from '@nx/devkit';
import type { Tree } from '@nx/devkit';
import { moduleGenerator } from './generator';

describe('module generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    // tsconfig.base.json is added by the workspace fixture but the generator
    // also needs it to merge path aliases — make sure it exists with the
    // shape we patch.
    if (!tree.exists('tsconfig.base.json')) {
      tree.write('tsconfig.base.json', JSON.stringify({ compilerOptions: { paths: {} } }, null, 2));
    }
  });

  it('creates project configuration with correct tags', async () => {
    await moduleGenerator(tree, {
      name: 'orders',
      directory: 'libs/modules',
      withCqrs: true,
    });

    const config = readProjectConfiguration(tree, 'modules-orders');
    expect(config.root).toBe('libs/modules/orders');
    expect(config.tags).toContain('scope:modules');
    expect(config.tags).toContain('module:orders');
    expect(config.targets?.['test']?.executor).toBe('@nx/vitest:test');
  });

  it('emits tsconfig and vitest config so build/typecheck targets are inferred', async () => {
    await moduleGenerator(tree, {
      name: 'orders',
      directory: 'libs/modules',
      withCqrs: false,
    });

    expect(tree.exists('libs/modules/orders/tsconfig.json')).toBe(true);
    expect(tree.exists('libs/modules/orders/tsconfig.lib.json')).toBe(true);
    expect(tree.exists('libs/modules/orders/tsconfig.spec.json')).toBe(true);
    expect(tree.exists('libs/modules/orders/vitest.config.mts')).toBe(true);
  });

  it('generates entity file', async () => {
    await moduleGenerator(tree, {
      name: 'products',
      directory: 'libs/modules',
      withCqrs: false,
    });

    expect(tree.exists('libs/modules/products/src/domain/entities/products.entity.ts')).toBe(true);
  });

  it('generates repository port file', async () => {
    await moduleGenerator(tree, {
      name: 'products',
      directory: 'libs/modules',
      withCqrs: false,
    });

    expect(tree.exists('libs/modules/products/src/domain/ports/products.repository.port.ts')).toBe(
      true,
    );
  });

  it('adds path alias to tsconfig.base.json', async () => {
    await moduleGenerator(tree, {
      name: 'invoices',
      directory: 'libs/modules',
      withCqrs: false,
    });

    const tsconfig = readJson(tree, 'tsconfig.base.json');
    expect(tsconfig.compilerOptions.paths['@nestjs-fastify-nx/modules-invoices']).toBeDefined();
    expect(tsconfig.compilerOptions.paths['@nestjs-fastify-nx/modules-invoices']).toEqual([
      './libs/modules/invoices/src/index.ts',
    ]);
  });

  it('generates cqrs files when withCqrs=true', async () => {
    await moduleGenerator(tree, {
      name: 'tasks',
      directory: 'libs/modules',
      withCqrs: true,
    });

    expect(
      tree.exists(
        'libs/modules/tasks/src/application/commands/create-tasks/create-tasks.command.ts',
      ),
    ).toBe(true);
  });

  it('emits controller route as the module name without pluralization', async () => {
    await moduleGenerator(tree, {
      name: 'users',
      directory: 'libs/modules',
      withCqrs: false,
    });

    const controller = tree.read(
      'libs/modules/users/src/presentation/controllers/users.controller.ts',
      'utf-8',
    );
    expect(controller).toContain("@Controller('users')");
    expect(controller).not.toContain("@Controller('userss')");
  });
});
