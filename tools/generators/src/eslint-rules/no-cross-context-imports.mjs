const PACKAGE = '@nestjs-fastify-nx/modules';
const GROUP_SOURCE_ROOT = 'libs/modules/src';

function splitPath(filename) {
  return String(filename ?? '').replace(/\\/g, '/').split('/');
}

function importerContextOf(filename) {
  const segments = splitPath(filename);
  if (segments.slice(0, 3).join('/') !== GROUP_SOURCE_ROOT) {
    return { insideGroup: false, context: undefined };
  }
  return { insideGroup: true, context: segments.length > 4 ? segments[3] : undefined };
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
    const { insideGroup, context: importerContext } = importerContextOf(context.filename ?? context.physicalFilename);

    function checkSource(sourceNode) {
      const facts = importFacts(sourceNode?.value);
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
