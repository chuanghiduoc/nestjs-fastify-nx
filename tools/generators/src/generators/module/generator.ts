import {
  formatFiles,
  generateFiles,
  names,
  offsetFromRoot,
  addProjectConfiguration,
} from '@nx/devkit';
import type { Tree } from '@nx/devkit';
import * as path from 'path';
import type { ModuleGeneratorSchema } from './schema';

type DirectoryEnum = 'modules' | 'composition';

const DIRECTORY_MAP: Record<DirectoryEnum, string> = {
  modules: 'libs/modules',
  composition: 'libs/composition',
};

// Normalizes the raw --directory option to the canonical enum value.
// Accepts full paths (libs/modules, libs/composition) for backward compat
// with old tooling that passed absolute-style paths. Any other value is
// rejected early so invalid project names / scope tags can never be generated.
function normalizeDirectory(raw: string): DirectoryEnum {
  const base = raw.replace(/^libs\//, '');
  if (base === 'modules' || base === 'composition') {
    return base;
  }
  throw new Error(
    `Invalid --directory "${raw}". Accepted values: "modules", "composition" ` +
      `(or their full-path equivalents "libs/modules", "libs/composition").`,
  );
}

export async function moduleGenerator(tree: Tree, options: ModuleGeneratorSchema): Promise<void> {
  const { name, withCqrs = true } = options;
  const rawDir = normalizeDirectory(options.directory ?? 'modules');
  const directory = DIRECTORY_MAP[rawDir];
  const moduleNames = names(name);
  const projectRoot = `${directory}/${moduleNames.fileName}`;
  const offset = offsetFromRoot(projectRoot);

  // Project name and scope tag are derived from the target directory so that
  // composition modules get `composition-foo` / `scope:composition` rather than
  // the modules variants — matching the convention in libs/composition/admin.
  const projectName = `${rawDir}-${moduleNames.fileName}`;
  const scopeTag = `scope:${rawDir}`;

  // All targets are inferred from config files by the workspace plugins:
  // `typecheck` by `@nx/js/typescript` (tsconfig.lib.json), `lint` by
  // `@nx/eslint/plugin`, and `test` by `@nx/vitest` (vitest.config.mts — see the
  // template in files/). No explicit target is declared, so the module needs no
  // hand-maintained `nx.json` include entry.
  addProjectConfiguration(tree, projectName, {
    root: projectRoot,
    projectType: 'library',
    sourceRoot: `${projectRoot}/src`,
    tags: [scopeTag, `type:feature`],
    targets: {},
  });

  // Import path mirrors the project name so consumers can tell at a glance
  // which scope a barrel belongs to — `@nestjs-fastify-nx/modules-users` is a
  // bounded-context module, `@nestjs-fastify-nx/composition-admin` is a
  // cross-cutting aggregate. Keep name and path in lockstep.
  const importPath = `@nestjs-fastify-nx/${projectName}`;
  generateFiles(tree, path.join(import.meta.dirname, 'files'), projectRoot, {
    ...moduleNames,
    withCqrs,
    projectName,
    importPath,
    projectRoot,
    offsetFromRoot: offset,
    template: '',
  });

  await formatFiles(tree);
}

export default moduleGenerator;
