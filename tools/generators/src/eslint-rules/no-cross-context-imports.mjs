const GROUPS = [
  {
    name: 'modules',
    package: '@nestjs-fastify-nx/modules',
    root: ['libs', 'modules', 'src'],
    allowedEdges: undefined,
    allowedSubpaths: [],
  },
  {
    name: 'infra',
    package: '@nestjs-fastify-nx/infra',
    root: ['libs', 'infra', 'src'],
    allowedEdges: {
      auth: ['database', 'i18n'],
      authorization: ['auth', 'database'],
      messaging: ['database'],
    },
    allowedSubpaths: ['authorization/testing'],
  },
];

const GROUP_BARREL = 'index';

function splitPath(filename) {
  return String(filename ?? '')
    .replace(/\\/g, '/')
    .split('/');
}

function findRootIndex(segments, root) {
  return segments.findIndex((segment, index) =>
    root.every((expected, offset) => segments[index + offset] === expected),
  );
}

function folderAtRoot(segments, group) {
  const rootIndex = findRootIndex(segments, group.root);
  if (rootIndex === -1) return undefined;
  const candidateIndex = rootIndex + group.root.length;
  if (segments.length <= candidateIndex) return undefined;
  const candidate = segments[candidateIndex];
  if (!candidate || candidate.includes('.')) return undefined;
  if (candidate === GROUP_BARREL && segments.length === candidateIndex + 1) return undefined;
  return { group, folder: candidate };
}

function importerGroupOf(filename) {
  const segments = splitPath(filename);
  for (const group of GROUPS) {
    const rootIndex = findRootIndex(segments, group.root);
    if (rootIndex === -1) continue;
    const folderIndex = rootIndex + group.root.length;
    return {
      group,
      folder: segments.length > folderIndex + 1 ? segments[folderIndex] : undefined,
    };
  }
  return { group: undefined, folder: undefined };
}

function resolveRelativeSpecifier(filename, specifier) {
  const segments = splitPath(filename);
  if (segments.length === 0) return undefined;
  const stack = segments.slice(0, -1);
  for (const segment of String(specifier).replace(/\\/g, '/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (stack.length === 0) return undefined;
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return stack;
}

function importFacts(source) {
  for (const group of GROUPS) {
    if (!source.startsWith(group.package)) continue;
    const rest = source.slice(group.package.length);
    if (rest === '') return { group, kind: 'root' };
    if (!rest.startsWith('/')) return undefined;
    const segments = rest.slice(1).split('/').filter(Boolean);
    if (segments.length === 0) return { group, kind: 'root' };
    const subpath = segments.join('/');
    const deep = segments.length > 1 && !group.allowedSubpaths.includes(subpath);
    return { group, kind: 'folder', folder: segments[0], deep };
  }
  return undefined;
}

function crossFolderAllowed(group, importerFolder, importedFolder) {
  if (!group.allowedEdges) return false;
  return (group.allowedEdges[importerFolder] ?? []).includes(importedFolder);
}

export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      crossContext:
        'Folder "{{importer}}" cannot import folder "{{imported}}" of the "{{group}}" group: cross-folder communication goes through the group barrel, a documented allowed edge, or libs/composition.',
      deepImport:
        'Deep import into "{{folder}}": import only the group barrel "@nestjs-fastify-nx/{{group}}/{{folder}}".',
      rootOutsideGroup:
        'The group root "@nestjs-fastify-nx/{{group}}" is only importable inside its own group source tree; import the specific folder instead.',
      unresolvableImport:
        'Import specifiers inside the "{{group}}" group must be static strings so the folder boundary can be checked.',
    },
  },
  create(context) {
    const importer = importerGroupOf(context.filename ?? context.physicalFilename);
    const importerGroup = importer.group;

    function checkRelative(sourceNode) {
      if (!importerGroup || !importer.folder) return;
      const resolved = resolveRelativeSpecifier(
        context.filename ?? context.physicalFilename,
        sourceNode?.value,
      );
      if (!resolved) return;
      const target = folderAtRoot(resolved, importerGroup);
      if (!target) return;
      if (target.folder === importer.folder) return;
      if (crossFolderAllowed(importerGroup, importer.folder, target.folder)) return;
      context.report({
        node: sourceNode,
        messageId: 'crossContext',
        data: {
          importer: importer.folder,
          imported: target.folder,
          group: importerGroup.name,
        },
      });
    }

    function checkSource(sourceNode) {
      const source = sourceNode?.value;
      if (typeof source !== 'string') return;
      if (source.startsWith('.')) {
        checkRelative(sourceNode);
        return;
      }
      const facts = importFacts(source);
      if (!facts) return;
      if (facts.kind === 'root') {
        if (importerGroup !== facts.group) {
          context.report({
            node: sourceNode,
            messageId: 'rootOutsideGroup',
            data: { group: facts.group.name },
          });
        }
        return;
      }
      if (facts.deep) {
        context.report({
          node: sourceNode,
          messageId: 'deepImport',
          data: { folder: facts.folder, group: facts.group.name },
        });
        return;
      }
      if (!importer.folder) return;
      if (facts.group !== importerGroup) return;
      if (facts.folder === importer.folder) return;
      if (crossFolderAllowed(importerGroup, importer.folder, facts.folder)) return;
      context.report({
        node: sourceNode,
        messageId: 'crossContext',
        data: {
          importer: importer.folder,
          imported: facts.folder,
          group: importerGroup.name,
        },
      });
    }

    function checkSpecifierNode(node) {
      if (node?.type === 'Literal') {
        checkSource(node);
        return;
      }
      if (node?.type === 'TemplateLiteral') {
        checkTemplateSpecifier(node);
      }
    }

    function checkTemplateSpecifier(node) {
      if (node.expressions.length === 0) {
        checkSource({ ...node, value: node.quasis[0].value.cooked });
        return;
      }
      if (!importerGroup || !importer.folder) return;
      context.report({
        node,
        messageId: 'unresolvableImport',
        data: { group: importerGroup.name },
      });
    }

    return {
      ImportDeclaration: (node) => checkSource(node.source),
      ExportNamedDeclaration: (node) => checkSource(node.source),
      ExportAllDeclaration: (node) => checkSource(node.source),
      ImportExpression: (node) => checkSpecifierNode(node.source),
      CallExpression: (node) => {
        if (node.callee?.type === 'Import') checkSpecifierNode(node.arguments?.[0]);
      },
      TSImportType: (node) => checkSpecifierNode(node.source ?? node.argument?.literal),
      TSImportEqualsDeclaration: (node) => {
        if (node.moduleReference?.type === 'TSExternalModuleReference') {
          checkSpecifierNode(node.moduleReference.expression);
        }
      },
    };
  },
};
