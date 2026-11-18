export const CONTRACT_EDGES = {
  notifications: ['organizations'],
};

export const INFRA_EDGES = {
  auth: ['database', 'i18n'],
  authorization: ['auth', 'database'],
  messaging: ['database'],
};

const CONTRACT_FOLDER = 'contract';
const CONTRACT_PURE_SOURCES = ['zod', '@nestjs-fastify-nx/shared'];

const GROUPS = [
  {
    name: 'modules',
    package: '@nestjs-fastify-nx/modules',
    root: ['libs', 'modules', 'src'],
    allowedEdges: undefined,
    contractEdges: CONTRACT_EDGES,
    allowedSubpaths: [],
  },
  {
    name: 'infra',
    package: '@nestjs-fastify-nx/infra',
    root: ['libs', 'infra', 'src'],
    allowedEdges: INFRA_EDGES,
    contractEdges: undefined,
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

export function findEdgeCycle(edges) {
  const finished = new Set();
  function visit(node, path) {
    const start = path.indexOf(node);
    if (start !== -1) return [...path.slice(start), node];
    if (finished.has(node)) return undefined;
    for (const next of edges[node] ?? []) {
      const cycle = visit(next, [...path, node]);
      if (cycle) return cycle;
    }
    finished.add(node);
    return undefined;
  }
  for (const node of Object.keys(edges)) {
    const cycle = visit(node, []);
    if (cycle) return cycle;
  }
  return undefined;
}

function folderAtRoot(segments, group) {
  const rootIndex = findRootIndex(segments, group.root);
  if (rootIndex === -1) return undefined;
  const candidateIndex = rootIndex + group.root.length;
  if (segments.length <= candidateIndex) return undefined;
  const candidate = segments[candidateIndex];
  if (!candidate || candidate.includes('.')) return undefined;
  if (candidate === GROUP_BARREL && segments.length === candidateIndex + 1) return undefined;
  return {
    group,
    folder: candidate,
    contract: Boolean(group.contractEdges) && segments[candidateIndex + 1] === CONTRACT_FOLDER,
  };
}

function contractRootOf(segments, group, folderIndex) {
  if (!group.contractEdges) return undefined;
  if (segments.length <= folderIndex + 2) return undefined;
  if (segments[folderIndex + 1] !== CONTRACT_FOLDER) return undefined;
  return segments.slice(0, folderIndex + 2);
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
      contractRoot: contractRootOf(segments, group, folderIndex),
    };
  }
  return { group: undefined, folder: undefined, contractRoot: undefined };
}

function isInside(segments, prefix) {
  return prefix.every((segment, index) => segments[index] === segment);
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
    const contract =
      Boolean(group.contractEdges) && segments.length === 2 && segments[1] === CONTRACT_FOLDER;
    const deep = segments.length > 1 && !contract && !group.allowedSubpaths.includes(subpath);
    return { group, kind: 'folder', folder: segments[0], deep, contract };
  }
  return undefined;
}

function crossFolderAllowed(group, importerFolder, importedFolder) {
  if (!group.allowedEdges) return false;
  return (group.allowedEdges[importerFolder] ?? []).includes(importedFolder);
}

function contractEdgeDeclared(group, importerFolder, importedFolder) {
  if (!group.contractEdges) return false;
  return (group.contractEdges[importerFolder] ?? []).includes(importedFolder);
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
      undeclaredContractEdge:
        'Context "{{importer}}" has no declared contract edge to "{{imported}}": add the edge to CONTRACT_EDGES in no-cross-context-imports.mjs, or keep the dependency out of this context.',
      relativeContractImport:
        'Import the contract of "{{imported}}" through "@nestjs-fastify-nx/modules/{{imported}}/contract", never by a relative path.',
      impureContract:
        'A contract file may import only zod, @nestjs-fastify-nx/shared and files inside its own contract folder; "{{source}}" is not allowed.',
      unresolvableImport:
        'Import specifiers inside the "{{group}}" group must be static strings so the folder boundary can be checked.',
    },
  },
  create(context) {
    const importer = importerGroupOf(context.filename ?? context.physicalFilename);
    const importerGroup = importer.group;

    function reportImpureContract(sourceNode) {
      context.report({
        node: sourceNode,
        messageId: 'impureContract',
        data: { source: sourceNode.value },
      });
    }

    function checkRelative(sourceNode) {
      if (!importerGroup || !importer.folder) return;
      const resolved = resolveRelativeSpecifier(
        context.filename ?? context.physicalFilename,
        sourceNode?.value,
      );
      if (!resolved) return;
      if (importer.contractRoot && !isInside(resolved, importer.contractRoot)) {
        reportImpureContract(sourceNode);
        return;
      }
      const target = folderAtRoot(resolved, importerGroup);
      if (!target) return;
      if (target.folder === importer.folder) return;
      if (crossFolderAllowed(importerGroup, importer.folder, target.folder)) return;
      context.report({
        node: sourceNode,
        messageId: target.contract ? 'relativeContractImport' : 'crossContext',
        data: {
          importer: importer.folder,
          imported: target.folder,
          group: importerGroup.name,
        },
      });
    }

    function checkContractEdge(sourceNode, facts) {
      if (contractEdgeDeclared(importerGroup, importer.folder, facts.folder)) return;
      context.report({
        node: sourceNode,
        messageId: 'undeclaredContractEdge',
        data: { importer: importer.folder, imported: facts.folder },
      });
    }

    function checkSource(sourceNode) {
      const source = sourceNode?.value;
      if (typeof source !== 'string') return;
      if (source.startsWith('.')) {
        checkRelative(sourceNode);
        return;
      }
      if (importer.contractRoot) {
        if (!CONTRACT_PURE_SOURCES.includes(source)) reportImpureContract(sourceNode);
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
      if (facts.contract) {
        checkContractEdge(sourceNode, facts);
        return;
      }
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
