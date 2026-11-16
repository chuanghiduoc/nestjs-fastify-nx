/// <reference types="vitest/globals" />
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { getProjects, readJson, readProjectConfiguration } from '@nx/devkit';
import type { Tree } from '@nx/devkit';
import * as ts from 'typescript';
import { moduleGenerator } from './generator';

const GROUP_PACKAGE = 'libs/modules/package.json';

interface ParsedSourceFile extends ts.SourceFile {
  readonly parseDiagnostics: readonly ts.Diagnostic[];
}

function listTypeScriptFiles(tree: Tree, dir: string): string[] {
  return tree.children(dir).flatMap((entry) => {
    const entryPath = `${dir}/${entry}`;
    if (!tree.isFile(entryPath)) {
      return listTypeScriptFiles(tree, entryPath);
    }
    return entryPath.endsWith('.ts') ? [entryPath] : [];
  });
}

function parseTypeScriptFile(tree: Tree, file: string): ParsedSourceFile {
  const source = tree.read(file, 'utf-8') ?? '';
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  ) as ParsedSourceFile;
}

function seedGroupPackage(tree: Tree): void {
  tree.write(
    GROUP_PACKAGE,
    JSON.stringify(
      {
        name: '@nestjs-fastify-nx/modules',
        version: '0.0.1',
        private: true,
        exports: {
          '.': { types: './src/index.ts', default: './src/index.ts' },
        },
      },
      null,
      2,
    ),
  );
}

describe('module generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    if (tree.exists('.oxfmtrc.json')) {
      tree.delete('.oxfmtrc.json');
    }
    if (!tree.exists('.prettierrc')) {
      tree.write(
        '.prettierrc',
        JSON.stringify({
          singleQuote: true,
          trailingComma: 'all',
          printWidth: 100,
          tabWidth: 2,
          semi: true,
          arrowParens: 'always',
          endOfLine: 'lf',
        }),
      );
    }
    if (!tree.exists('tsconfig.base.json')) {
      tree.write('tsconfig.base.json', JSON.stringify({ compilerOptions: { composite: true } }));
    }
    seedGroupPackage(tree);
  });

  describe('folder modules (directory=modules)', () => {
    it('scaffolds a flat folder under libs/modules/src and registers no project', async () => {
      await moduleGenerator(tree, { name: 'orders', directory: 'modules', withCqrs: true });

      expect(tree.exists('libs/modules/src/orders/orders.module.ts')).toBe(true);
      expect([...getProjects(tree).keys()]).not.toContain('modules-orders');
      expect(() => readProjectConfiguration(tree, 'modules-orders')).toThrow();
    });

    it('emits the leaf file set with colocated operations and adapter', async () => {
      await moduleGenerator(tree, { name: 'orders', directory: 'modules', withCqrs: true });
      const folder = 'libs/modules/src/orders';

      for (const file of [
        'orders.module.ts',
        'index.ts',
        'orders.controller.ts',
        'orders.controller.spec.ts',
        'orders.dto.ts',
        'create-orders.ts',
        'list-orders.ts',
        'orders-repository.port.ts',
        'prisma-orders.repository.ts',
        'prisma-orders.repository.integration.spec.ts',
      ]) {
        expect(tree.exists(`${folder}/${file}`), file).toBe(true);
      }
    });

    it('generates parsable TypeScript for kebab-case names', async () => {
      await moduleGenerator(tree, { name: 'order-items', directory: 'modules', withCqrs: true });
      const folder = 'libs/modules/src/order-items';

      const create = tree.read(`${folder}/create-order-items.ts`, 'utf-8') ?? '';
      expect(create).toContain('private readonly orderItems:');
      expect(create).toContain('this.orderItems.create(');
      expect(create).not.toContain('order-items.');

      const repository = tree.read(`${folder}/prisma-order-items.repository.ts`, 'utf-8') ?? '';
      expect(repository).toContain('.orderItems.create(');
      expect(repository).toContain('.orderItems.findFirst(');
      expect(repository).toContain('.orderItems.findMany(');
      expect(repository).not.toContain('order-items.');

      const generated = listTypeScriptFiles(tree, folder);
      expect(generated.length).toBeGreaterThan(0);
      for (const file of generated) {
        expect(parseTypeScriptFile(tree, file).parseDiagnostics, file).toEqual([]);
      }
    });

    it('emits no project files: no package.json, project.json, tsconfig or vitest config', async () => {
      await moduleGenerator(tree, { name: 'orders', directory: 'modules', withCqrs: true });

      expect(tree.exists('libs/modules/orders')).toBe(false);
      for (const file of [
        'package.json',
        'project.json',
        'tsconfig.json',
        'tsconfig.lib.json',
        'tsconfig.spec.json',
        'vitest.config.mts',
      ]) {
        expect(tree.exists(`libs/modules/src/orders/${file}`), file).toBe(false);
      }
    });

    it('adds the exports-map entry to the group package.json and keeps entries sorted', async () => {
      seedGroupPackageModified(tree);
      await moduleGenerator(tree, { name: 'orders', directory: 'modules', withCqrs: true });

      const pkg = readJson(tree, GROUP_PACKAGE);
      expect(pkg.exports['./orders']).toEqual({
        types: './src/orders/index.ts',
        default: './src/orders/index.ts',
      });
      expect(pkg.exports['./users']).toEqual({
        types: './src/users/index.ts',
        default: './src/users/index.ts',
      });
      expect(pkg.exports['.']).toEqual({ types: './src/index.ts', default: './src/index.ts' });
      expect(Object.keys(pkg.exports)).toEqual([...Object.keys(pkg.exports)].sort());
    });

    it('colocates the command with its handler in one operation file', async () => {
      await moduleGenerator(tree, { name: 'orders', directory: 'modules', withCqrs: true });

      const create = tree.read('libs/modules/src/orders/create-orders.ts', 'utf-8') ?? '';
      expect(create).toContain(
        "import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs'",
      );
      expect(create).toContain('export class CreateOrdersCommand extends Command<OrdersDto>');
      expect(create).toContain('@CommandHandler(CreateOrdersCommand)');
      expect(create).toMatch(/implements ICommandHandler<\s*CreateOrdersCommand,\s*OrdersDto\s*>/);
      expect(create).not.toContain('@Injectable()');
    });

    it('colocates the query with its handler in one operation file', async () => {
      await moduleGenerator(tree, { name: 'orders', directory: 'modules', withCqrs: true });

      const list = tree.read('libs/modules/src/orders/list-orders.ts', 'utf-8') ?? '';
      expect(list).toContain(
        "import { Query, QueryHandler, type IQueryHandler } from '@nestjs/cqrs'",
      );
      expect(list).toContain('export class ListOrdersQuery extends Query<ListOrdersResult>');
      expect(list).toContain('@QueryHandler(ListOrdersQuery)');
      expect(list).toMatch(/implements IQueryHandler<\s*ListOrdersQuery,\s*ListOrdersResult\s*>/);
    });

    it('registers the repository provider and both handlers in the module', async () => {
      await moduleGenerator(tree, { name: 'orders', directory: 'modules', withCqrs: true });

      const moduleFile = tree.read('libs/modules/src/orders/orders.module.ts', 'utf-8') ?? '';
      expect(moduleFile).toContain('ORDERS_REPOSITORY, useClass: PrismaOrdersRepository');
      expect(moduleFile).toContain('ListOrdersHandler');
      expect(moduleFile).toContain('CreateOrdersHandler');
    });

    it('exports commands and queries from the barrel, never handlers', async () => {
      await moduleGenerator(tree, { name: 'orders', directory: 'modules', withCqrs: true });

      const barrel = tree.read('libs/modules/src/orders/index.ts', 'utf-8') ?? '';
      expect(barrel).toContain('CreateOrdersCommand');
      expect(barrel).toContain('ListOrdersQuery');
      expect(barrel).not.toContain('CreateOrdersHandler');
      expect(barrel).not.toContain('ListOrdersHandler');
    });

    it('controller dispatches through the buses and validates the id param declaratively', async () => {
      await moduleGenerator(tree, { name: 'orders', directory: 'modules', withCqrs: true });

      const controller = tree.read('libs/modules/src/orders/orders.controller.ts', 'utf-8') ?? '';
      expect(controller).toContain('@CurrentUser()');
      expect(controller).toContain('requireOrganizationId(');
      expect(controller).toContain('new CreateOrdersCommand');
      expect(controller).toContain('new ListOrdersQuery');
      expect(controller).toContain('@ApiPaginatedResponse');
      expect(controller).not.toContain('ApiOkResponse');
    });

    it('repository adapter targets the prisma delegate with tenant scoping and keyset pagination', async () => {
      await moduleGenerator(tree, { name: 'orders', directory: 'modules', withCqrs: true });

      const repo = tree.read('libs/modules/src/orders/prisma-orders.repository.ts', 'utf-8') ?? '';
      expect(repo).toContain('implements OrdersRepositoryPort');
      expect(repo).toMatch(/writeTarget\(\)\.orders\.create/);
      expect(repo).toMatch(/writeTarget\(\)\.orders\.findFirst/);
      expect(repo).toMatch(/readTarget\(\)\.orders\.findMany/);
      expect(repo).toContain('organizationId');
      expect(repo).toContain('keysetAfter');
      expect(repo).toContain('takePage');
    });

    it('integration spec colocates with the adapter and uses the Testcontainers harness', async () => {
      await moduleGenerator(tree, { name: 'orders', directory: 'modules', withCqrs: true });

      const spec =
        tree.read(
          'libs/modules/src/orders/prisma-orders.repository.integration.spec.ts',
          'utf-8',
        ) ?? '';
      expect(spec).toContain('createTestContainers');
      expect(spec).toContain('DatabaseCleaner');
      expect(spec).toContain('PrismaOrdersRepository');
    });

    it('presentation dto is the only template file importing @nestjs/swagger', async () => {
      await moduleGenerator(tree, { name: 'orders', directory: 'modules', withCqrs: true });

      for (const file of [
        'orders.module.ts',
        'index.ts',
        'create-orders.ts',
        'list-orders.ts',
        'orders-repository.port.ts',
        'prisma-orders.repository.ts',
      ]) {
        const content = tree.read(`libs/modules/src/orders/${file}`, 'utf-8') ?? '';
        expect(content, `${file} must not import @nestjs/swagger`).not.toContain('@nestjs/swagger');
      }
      const dto = tree.read('libs/modules/src/orders/orders.dto.ts', 'utf-8') ?? '';
      expect(dto).toContain('@nestjs/swagger');
    });

    it('emitted files contain zero TODO or FIXME', async () => {
      await moduleGenerator(tree, { name: 'orders', directory: 'modules', withCqrs: true });

      const filesToCheck = [
        'orders.module.ts',
        'index.ts',
        'orders.controller.ts',
        'orders.dto.ts',
        'create-orders.ts',
        'list-orders.ts',
        'prisma-orders.repository.ts',
        'prisma-orders.repository.integration.spec.ts',
      ];
      for (const file of filesToCheck) {
        const content = tree.read(`libs/modules/src/orders/${file}`, 'utf-8') ?? '';
        expect(content, `${file} contains TODO`).not.toMatch(/\bTODO\b/);
        expect(content, `${file} contains FIXME`).not.toMatch(/\bFIXME\b/);
      }
    });

    it('refuses to scaffold over an existing folder', async () => {
      tree.write('libs/modules/src/orders/orders.module.ts', 'export {}');

      await expect(
        moduleGenerator(tree, { name: 'orders', directory: 'modules', withCqrs: true }),
      ).rejects.toThrow(/already exists/);
    });

    it('withCqrs=false omits the colocated operation files and still wires the repository', async () => {
      await moduleGenerator(tree, { name: 'orders', directory: 'modules', withCqrs: false });

      expect(tree.exists('libs/modules/src/orders/create-orders.ts')).toBe(false);
      expect(tree.exists('libs/modules/src/orders/list-orders.ts')).toBe(false);

      const moduleFile = tree.read('libs/modules/src/orders/orders.module.ts', 'utf-8') ?? '';
      expect(moduleFile).toContain('ORDERS_REPOSITORY, useClass: PrismaOrdersRepository');
      expect(moduleFile).not.toContain('CreateOrdersHandler');
      expect(moduleFile).not.toContain('ListOrdersHandler');

      const controller = tree.read('libs/modules/src/orders/orders.controller.ts', 'utf-8') ?? '';
      expect(controller).toContain('list(');
      expect(controller).not.toMatch(/CommandBus|QueryBus/);
      expect(controller).not.toContain("from '@nestjs/cqrs'");

      for (const file of listTypeScriptFiles(tree, 'libs/modules/src/orders')) {
        expect(parseTypeScriptFile(tree, file).parseDiagnostics, file).toEqual([]);
      }
    });
  });

  describe('composition modules (directory=composition, unchanged orchestrator scaffold)', () => {
    it('places module under libs/composition with correct project name and scope tag', async () => {
      await moduleGenerator(tree, { name: 'admin', directory: 'composition', withCqrs: false });

      const config = readProjectConfiguration(tree, 'composition-admin');
      expect(config.root).toBe('libs/composition/admin');
      expect(config.tags).toEqual(['scope:composition']);
      expect(tree.exists('libs/composition/admin/src/admin.module.ts')).toBe(true);
    });

    it('composition module workspace package uses composition- prefix', async () => {
      await moduleGenerator(tree, { name: 'billing', directory: 'composition', withCqrs: false });

      const packageJson = readJson(tree, 'libs/composition/billing/package.json');
      expect(packageJson.name).toBe('@nestjs-fastify-nx/composition-billing');
    });

    it('emits project files (package.json, tsconfig, vitest config) for composition', async () => {
      await moduleGenerator(tree, { name: 'billing', directory: 'composition', withCqrs: false });

      for (const file of [
        'package.json',
        'tsconfig.json',
        'tsconfig.lib.json',
        'tsconfig.spec.json',
        'vitest.config.mts',
      ]) {
        expect(tree.exists(`libs/composition/billing/${file}`), file).toBe(true);
      }
    });

    it('never generates domain/application/infrastructure/testing layers for composition', async () => {
      await moduleGenerator(tree, { name: 'billing', directory: 'composition', withCqrs: false });

      for (const layer of ['domain', 'application', 'infrastructure', 'testing']) {
        expect(tree.exists(`libs/composition/billing/src/${layer}`), layer).toBe(false);
      }
      expect(tree.exists('libs/composition/billing/src/billing-listeners.module.ts')).toBe(false);
    });

    it('leaves the group package.json untouched', async () => {
      await moduleGenerator(tree, { name: 'admin', directory: 'composition', withCqrs: false });

      const pkg = readJson(tree, GROUP_PACKAGE);
      expect(Object.keys(pkg.exports)).toEqual(['.']);
    });

    it('names the vitest project after the resolved project name', async () => {
      await moduleGenerator(tree, { name: 'billing', directory: 'composition', withCqrs: false });

      const vitestConfig = tree.read('libs/composition/billing/vitest.config.mts', 'utf-8') ?? '';
      expect(vitestConfig).toContain("name: 'composition-billing'");
    });
  });

  describe('directory normalization — backward compat full paths', () => {
    it('accepts "libs/modules" as equivalent to "modules"', async () => {
      await moduleGenerator(tree, { name: 'payments', directory: 'libs/modules', withCqrs: false });

      expect(tree.exists('libs/modules/src/payments/payments.module.ts')).toBe(true);
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

function seedGroupPackageModified(tree: Tree): void {
  tree.write(
    GROUP_PACKAGE,
    JSON.stringify(
      {
        name: '@nestjs-fastify-nx/modules',
        version: '0.0.1',
        private: true,
        exports: {
          '.': { types: './src/index.ts', default: './src/index.ts' },
          './users': { types: './src/users/index.ts', default: './src/users/index.ts' },
        },
      },
      null,
      2,
    ),
  );
}
