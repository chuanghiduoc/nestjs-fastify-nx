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
  const { name, directory = 'libs/modules', withCqrs = true } = options;
  const moduleNames = names(name);
  const projectRoot = `${directory}/${moduleNames.fileName}`;
  const offset = offsetFromRoot(projectRoot);

  // `build` and `typecheck` targets are auto-inferred by `@nx/js/typescript`
  // from `tsconfig.lib.json`; `lint` is inferred by `@nx/eslint/plugin` from
  // the workspace eslint config. We only need to declare the test target
  // explicitly because the executor takes module-specific options.
  addProjectConfiguration(tree, `modules-${moduleNames.fileName}`, {
    root: projectRoot,
    projectType: 'library',
    sourceRoot: `${projectRoot}/src`,
    tags: [`scope:modules`, `module:${moduleNames.fileName}`],
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

  const importPath = `@nestjs-fastify-nx/${moduleNames.fileName}`;
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
