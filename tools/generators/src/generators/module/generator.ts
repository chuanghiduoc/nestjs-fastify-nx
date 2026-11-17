import {
  addProjectConfiguration,
  formatFiles,
  generateFiles,
  names,
  offsetFromRoot,
  updateJson,
} from '@nx/devkit';
import type { Tree } from '@nx/devkit';
import * as path from 'path';
import { registerPermissions, type PermissionAction } from './register-permissions';
import type { ModuleGeneratorSchema } from './schema';

type DirectoryEnum = 'modules' | 'composition';

type ModuleNames = ReturnType<typeof names>;

const GROUP_PACKAGE = 'libs/modules/package.json';

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
  const moduleNames = names(name);

  if (rawDir === 'modules') {
    generateFolderModule(tree, moduleNames, withCqrs);
  } else {
    generateCompositionModule(tree, moduleNames);
  }

  await formatFiles(tree);
}

// A bounded context is a folder inside the modules group: no project, no package,
// no tsconfig — the group carries all of those, and the exports map is the only
// wiring the context needs.
function generateFolderModule(tree: Tree, moduleNames: ModuleNames, withCqrs: boolean): void {
  const folderRoot = `libs/modules/src/${moduleNames.fileName}`;
  if (tree.exists(folderRoot) || tree.exists(`${folderRoot}/index.ts`)) {
    throw new Error(`Folder "${folderRoot}" already exists.`);
  }

  registerPermissions(tree, {
    constantName: moduleNames.constantName,
    resourceType: moduleNames.fileName.replace(/-/g, '_'),
    actions: permissionActionsFor(withCqrs),
  });

  generateFiles(tree, path.join(import.meta.dirname, 'files'), folderRoot, {
    ...moduleNames,
    withCqrs,
    template: '',
  });

  if (!withCqrs) {
    tree.delete(`${folderRoot}/create-${moduleNames.fileName}.ts`);
    tree.delete(`${folderRoot}/list-${moduleNames.fileName}.ts`);
  }

  updateJson(tree, GROUP_PACKAGE, (json: Record<string, unknown>) => {
    const exports = (json['exports'] ?? {}) as Record<string, unknown>;
    exports[`./${moduleNames.fileName}`] = {
      types: `./src/${moduleNames.fileName}/index.ts`,
      default: `./src/${moduleNames.fileName}/index.ts`,
    };
    json['exports'] = Object.fromEntries(
      Object.entries(exports).sort(([a], [b]) => a.localeCompare(b)),
    );
    return json;
  });
}

function permissionActionsFor(withCqrs: boolean): readonly PermissionAction[] {
  return withCqrs ? ['read', 'create'] : ['read'];
}

// Composition stays a real Nx project: it owns an HTTP surface that orchestrates
// several contexts, so it keeps its own package, tsconfig and vitest project.
function generateCompositionModule(tree: Tree, moduleNames: ModuleNames): void {
  const projectRoot = `libs/composition/${moduleNames.fileName}`;
  const projectName = `composition-${moduleNames.fileName}`;
  const offset = offsetFromRoot(projectRoot);
  const importPath = `@nestjs-fastify-nx/${projectName}`;

  addProjectConfiguration(tree, projectName, {
    root: projectRoot,
    projectType: 'library',
    sourceRoot: `${projectRoot}/src`,
    tags: ['scope:composition'],
    targets: {},
  });

  generateFiles(tree, path.join(import.meta.dirname, 'files-composition'), projectRoot, {
    ...moduleNames,
    projectName,
    importPath,
    projectRoot,
    offsetFromRoot: offset,
    template: '',
  });
}

export default moduleGenerator;
