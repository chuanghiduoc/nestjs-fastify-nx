import {
  Tree,
  formatFiles,
  generateFiles,
  names,
  offsetFromRoot,
  addProjectConfiguration,
  updateJson,
} from '@nx/devkit';
import * as path from 'path';
import type { ModuleGeneratorSchema } from './schema';

export async function moduleGenerator(tree: Tree, options: ModuleGeneratorSchema): Promise<void> {
  const { name, withCqrs = true } = options;
  // Map shorthand enums to full paths for backward compat with raw full paths.
  const directoryMap: Record<string, string> = {
    modules: 'libs/modules',
    composition: 'libs/composition',
  };
  const rawDir = options.directory ?? 'modules';
  const directory = directoryMap[rawDir] ?? rawDir;
  const moduleNames = names(name);
  const projectRoot = `${directory}/${moduleNames.fileName}`;
  const offset = offsetFromRoot(projectRoot);

  // Project name and scope tag are derived from the target directory so that
  // composition modules get `composition-foo` / `scope:composition` rather than
  // the modules variants — matching the convention in libs/composition/admin.
  const projectName = `${rawDir}-${moduleNames.fileName}`;
  const scopeTag = `scope:${rawDir}`;

  // `build` and `typecheck` targets are auto-inferred by `@nx/js/typescript`
  // from `tsconfig.lib.json`; `lint` is inferred by `@nx/eslint/plugin` from
  // the workspace eslint config. We only need to declare the test target
  // explicitly because the executor takes module-specific options.
  addProjectConfiguration(tree, projectName, {
    root: projectRoot,
    projectType: 'library',
    sourceRoot: `${projectRoot}/src`,
    tags: [scopeTag, `type:feature`],
    targets: {
      test: {
        executor: '@nx/vitest:test',
        outputs: ['{options.reportsDirectory}'],
        options: {
          passWithNoTests: true,
          reportsDirectory: `coverage/${projectRoot}`,
        },
      },
    },
  });

  // Import path mirrors the project name so consumers can tell at a glance
  // which scope a barrel belongs to — `@nestjs-fastify-nx/modules-users` is a
  // bounded-context module, `@nestjs-fastify-nx/composition-admin` is a
  // cross-cutting aggregate. Keep name and path in lockstep.
  const importPath = `@nestjs-fastify-nx/${projectName}`;
  updateJson(tree, 'tsconfig.base.json', (json) => {
    json.compilerOptions.paths ??= {};
    json.compilerOptions.paths[importPath] = [`./${projectRoot}/src/index.ts`];
    return json;
  });

  generateFiles(tree, path.join(__dirname, 'files'), projectRoot, {
    ...moduleNames,
    withCqrs,
    projectRoot,
    offsetFromRoot: offset,
    template: '',
  });

  await formatFiles(tree);
}

export default moduleGenerator;
