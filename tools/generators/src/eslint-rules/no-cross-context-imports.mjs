const PACKAGE = '@nestjs-fastify-nx/modules';

function splitPath(filename) {
  return String(filename ?? '')
    .replace(/\\/g, '/')
    .split('/');
}

function importerContextOf(filename) {
  const segments = splitPath(filename);
  const rootIndex = segments.findIndex(
    (segment, index) =>
      segment === 'libs' && segments[index + 1] === 'modules' && segments[index + 2] === 'src',
  );
  if (rootIndex === -1) {
    return { insideGroup: false, context: undefined };
  }
  return {
    insideGroup: true,
    context: segments.length > rootIndex + 4 ? segments[rootIndex + 3] : undefined,
  };
}

function contextOfResolvedPath(segments) {
  const rootIndex = segments.findIndex(
    (segment, index) =>
      segment === 'libs' && segments[index + 1] === 'modules' && segments[index + 2] === 'src',
  );
  if (rootIndex === -1) return undefined;
  if (segments.length <= rootIndex + 3) return undefined;
  const candidate = segments[rootIndex + 3];
  if (candidate.includes('.')) return undefined;
  return candidate;
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
  if (typeof source !== 'string' || !source.startsWith(PACKAGE)) return undefined;
  const rest = source.slice(PACKAGE.length);
  if (rest === '') return { kind: 'root' };
  if (!rest.startsWith('/')) return undefined;
  const segments = rest.slice(1).split('/').filter(Boolean);
  if (segments.length === 0) return { kind: 'root' };
  return { kind: 'context', context: segments[0], deep: segments.length > 1 };
}

export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      crossContext:
        'Context "{{importer}}" cannot import context "{{imported}}": cross-context communication goes through libs/composition.',
      deepImport:
        'Deep import into "{{context}}": import only the context barrel "@nestjs-fastify-nx/modules/{{context}}".',
      rootOutsideGroup:
        'The group root "@nestjs-fastify-nx/modules" is only importable inside libs/modules/src; import the specific context instead.',
    },
  },
  create(context) {
    const { insideGroup, context: importerContext } = importerContextOf(
      context.filename ?? context.physicalFilename,
    );

    function checkRelative(sourceNode) {
      if (!importerContext) return;
      const resolved = resolveRelativeSpecifier(
        context.filename ?? context.physicalFilename,
        sourceNode?.value,
      );
      if (!resolved) return;
      const targetContext = contextOfResolvedPath(resolved);
      if (targetContext && targetContext !== importerContext) {
        context.report({
          node: sourceNode,
          messageId: 'crossContext',
          data: { importer: importerContext, imported: targetContext },
        });
      }
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
        if (!insideGroup) {
          context.report({ node: sourceNode, messageId: 'rootOutsideGroup' });
        }
        return;
      }
      if (facts.deep) {
        context.report({
          node: sourceNode,
          messageId: 'deepImport',
          data: { context: facts.context },
        });
        return;
      }
      if (importerContext && facts.context !== importerContext) {
        context.report({
          node: sourceNode,
          messageId: 'crossContext',
          data: { importer: importerContext, imported: facts.context },
        });
      }
    }

    function checkDynamicImport(node) {
      const argument = node.arguments?.[0];
      if (argument?.type === 'Literal' && typeof argument.value === 'string') {
        checkSource(argument);
      }
    }

    return {
      ImportDeclaration: (node) => checkSource(node.source),
      ExportNamedDeclaration: (node) => checkSource(node.source),
      ExportAllDeclaration: (node) => checkSource(node.source),
      ImportExpression: (node) => {
        if (node.source?.type === 'Literal' && typeof node.source.value === 'string') {
          checkSource(node.source);
        }
      },
      CallExpression: (node) => {
        if (node.callee?.type === 'Import') checkDynamicImport(node);
      },
    };
  },
};
