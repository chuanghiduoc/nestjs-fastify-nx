import ts from 'typescript';
import { loadPrismaSchema } from './prisma-schema.mjs';
import { TABLE_GRANTS, TABLE_OWNERS } from './table-ownership.map.mjs';

const PRISMA_CLIENT_SEGMENT = '/generated/prisma/';
const PRISMA_MODEL_FILE = /\/generated\/prisma\/models\/(\w+)\.ts$/;
const CLIENT_MARKER = '$queryRaw';
const WRITE_INPUT_TYPE = /Create|Update|Upsert/;
const SQL_IDENTIFIER = String.raw`(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const TABLE_KEYWORD =
  /\b(INSERT\s+INTO|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE(?:\s+TABLE)?|(?:ALTER|DROP)\s+TABLE(?:\s+IF\s+EXISTS)?|UPDATE|INTO|FROM|JOIN|USING|TABLE)\b/gi;
const READ_TABLE_KEYWORDS = new Set(['FROM', 'JOIN', 'USING', 'TABLE']);
const TABLE_NAME = new RegExp(
  String.raw`^\s*(?:ONLY\s+)?(?:${SQL_IDENTIFIER}\s*\.\s*)?(${SQL_IDENTIFIER})`,
  'i',
);
const NEXT_LISTED_TABLE = new RegExp(String.raw`^\s*(?:(?:AS\s+)?${SQL_IDENTIFIER}\s*)?,`, 'i');
const WRITE_METHODS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);
const RAW_METHODS = new Map([
  ['$queryRaw', 'read'],
  ['$queryRawUnsafe', 'read'],
  ['$executeRaw', 'write'],
  ['$executeRawUnsafe', 'write'],
]);

function splitPath(filename) {
  return String(filename ?? '')
    .replace(/\\/g, '/')
    .split('/');
}

function normalizePath(filename) {
  return String(filename).replace(/\\/g, '/');
}

function sequenceIndex(segments, sequence) {
  return segments.findIndex((_segment, index) =>
    sequence.every((expected, offset) => segments[index + offset] === expected),
  );
}

export function accessorOf(filename) {
  const segments = splitPath(filename);
  const modulesIndex = sequenceIndex(segments, ['libs', 'modules', 'src']);
  if (modulesIndex !== -1) {
    const folderIndex = modulesIndex + 3;
    return segments.length > folderIndex + 1 ? `modules/${segments[folderIndex]}` : undefined;
  }
  const appIndex = segments.findIndex(
    (segment, index) => segment === 'apps' && segments[index + 2] === 'src',
  );
  return appIndex === -1 ? undefined : `apps/${segments[appIndex + 1]}`;
}

function delegateNameOf(model) {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

function indexSchema(models) {
  const modelByDelegate = new Map();
  const modelByTable = new Map();
  const relationFieldNames = new Set();
  for (const [model, { table, relations }] of models) {
    modelByDelegate.set(delegateNameOf(model), model);
    modelByTable.set(table, model);
    for (const field of relations.keys()) relationFieldNames.add(field);
  }
  return { modelByDelegate, modelByTable, relationFieldNames };
}

function declaredInPrismaClient(symbol) {
  return (symbol?.declarations ?? []).some((declaration) =>
    normalizePath(declaration.getSourceFile().fileName).includes(PRISMA_CLIENT_SEGMENT),
  );
}

function enclosingTypeName(declaration) {
  for (let node = declaration.parent; node; node = node.parent) {
    if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) return node.name.text;
  }
  return '';
}

function flattenTypes(types) {
  return types.flatMap((type) => (type.isUnion() ? flattenTypes(type.types) : [type]));
}

function relationDeclaredIn(models, declaration, field, typeName) {
  const fileName = normalizePath(declaration.getSourceFile().fileName);
  const model = PRISMA_MODEL_FILE.exec(fileName)?.[1];
  const target = model && models.get(model)?.relations.get(field);
  if (!target) return undefined;
  return { target, mode: WRITE_INPUT_TYPE.test(typeName) ? 'write' : 'read' };
}

function relationOfMatch(models, { type, symbol }, field) {
  for (const declaration of symbol.declarations ?? []) {
    const relation = relationDeclaredIn(models, declaration, field, enclosingTypeName(declaration));
    if (relation) return relation;
  }
  const alias = type.aliasSymbol;
  for (const declaration of alias?.declarations ?? []) {
    const relation = relationDeclaredIn(models, declaration, field, alias.name);
    if (relation) return relation;
  }
  return undefined;
}

function relationOfMatches(models, matches, field) {
  for (const match of matches) {
    const relation = relationOfMatch(models, match, field);
    if (relation) return relation;
  }
  return undefined;
}

function findVariable(scope, name) {
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(name);
    if (variable) return variable;
  }
  return undefined;
}

function initializerOf(variable) {
  const definition = variable?.defs[0];
  return definition?.type === 'Variable' ? definition.node.init : undefined;
}

function createTypeWalker({ checker, sourceCode, visitProperty }) {
  const resolving = new Set();

  function propertyMatches(types, field) {
    return types.flatMap((type) => {
      const symbol = checker.getPropertyOfType(type, field);
      return symbol ? [{ type, symbol }] : [];
    });
  }

  function valueTypesOf(matches) {
    return flattenTypes(
      matches.map(({ symbol }) => checker.getNonNullableType(checker.getTypeOfSymbol(symbol))),
    );
  }

  function walkObject(node, types) {
    for (const property of node.properties) {
      if (property.type === 'SpreadElement') {
        walk(property.argument, types);
        continue;
      }
      const field = propertyKeyName(property);
      const matches = field ? propertyMatches(types, field) : [];
      if (matches.length === 0) continue;
      visitProperty(property, field, matches);
      walk(property.value, valueTypesOf(matches));
    }
  }

  function walkArray(node, types) {
    const elementTypes = flattenTypes(
      types.map((type) => type.getNumberIndexType()).filter(Boolean),
    );
    for (const element of node.elements) {
      walk(element?.type === 'SpreadElement' ? element.argument : element, elementTypes);
    }
  }

  function walkIdentifier(node, types) {
    const initializer = initializerOf(findVariable(sourceCode.getScope(node), node.name));
    if (!initializer || resolving.has(initializer)) return;
    resolving.add(initializer);
    walk(initializer, types);
    resolving.delete(initializer);
  }

  function walk(node, types) {
    switch (node?.type) {
      case 'ObjectExpression':
        walkObject(node, types);
        return;
      case 'ArrayExpression':
        walkArray(node, types);
        return;
      case 'ConditionalExpression':
        walk(node.consequent, types);
        walk(node.alternate, types);
        return;
      case 'LogicalExpression':
        walk(node.left, types);
        walk(node.right, types);
        return;
      case 'TSAsExpression':
      case 'TSSatisfiesExpression':
      case 'TSNonNullExpression':
        walk(node.expression, types);
        return;
      case 'Identifier':
        walkIdentifier(node, types);
        return;
      default:
        return;
    }
  }

  return { walk, propertyMatches };
}

function memberName(node) {
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (
    node.computed &&
    node.property.type === 'Literal' &&
    typeof node.property.value === 'string'
  ) {
    return node.property.value;
  }
  return undefined;
}

function propertyKeyName(property) {
  if (property.computed) return undefined;
  if (property.key.type === 'Identifier') return property.key.name;
  if (property.key.type === 'Literal' && typeof property.key.value === 'string') {
    return property.key.value;
  }
  return undefined;
}

function rawSqlText(memberNode) {
  const parent = memberNode.parent;
  if (parent?.type === 'TaggedTemplateExpression' && parent.tag === memberNode) {
    return parent.quasi.quasis.map((quasi) => quasi.value.cooked ?? '').join(' ');
  }
  if (parent?.type !== 'CallExpression' || parent.callee !== memberNode) return '';
  const [query] = parent.arguments;
  if (query?.type === 'Literal' && typeof query.value === 'string') return query.value;
  if (query?.type === 'TemplateLiteral') {
    return query.quasis.map((quasi) => quasi.value.cooked ?? '').join(' ');
  }
  return '';
}

function unquotedTableName(identifier) {
  const name = identifier.startsWith('"') ? identifier.slice(1, -1) : identifier;
  return name.toLowerCase();
}

function listedTables(text) {
  const tables = [];
  let rest = text;
  for (;;) {
    const table = TABLE_NAME.exec(rest);
    if (!table) return tables;
    tables.push(unquotedTableName(table[1]));
    rest = rest.slice(table[0].length);
    const separator = NEXT_LISTED_TABLE.exec(rest);
    if (!separator) return tables;
    rest = rest.slice(separator[0].length);
  }
}

function keywordMode(keyword) {
  const [leadingWord] = keyword.toUpperCase().split(/\s+/);
  return READ_TABLE_KEYWORDS.has(leadingWord) ? 'read' : 'write';
}

function tableReferences(sql) {
  return [...sql.matchAll(TABLE_KEYWORD)].flatMap((match) => {
    const mode = keywordMode(match[1]);
    const following = sql.slice(match.index + match[0].length);
    return listedTables(following).map((table) => ({ table, mode }));
  });
}

export function rawSqlTables(sql, methodMode) {
  const references = tableReferences(sql);
  const writesNoKnownTarget =
    methodMode === 'write' && !references.some(({ mode }) => mode === 'write');
  const tables = new Map();
  for (const { table, mode } of references) {
    if (tables.get(table) === 'write') continue;
    tables.set(table, mode === 'write' || writesNoKnownTarget ? 'write' : 'read');
  }
  return tables;
}

function calledMethodName(memberNode) {
  const parent = memberNode.parent;
  if (parent?.type !== 'MemberExpression' || parent.object !== memberNode) return undefined;
  return memberName(parent);
}

function delegateAccessMode(memberNode) {
  const method = calledMethodName(memberNode);
  if (method === undefined) return 'write';
  return WRITE_METHODS.has(method) ? 'write' : 'read';
}

const messages = {
  foreignDelegate:
    '"{{accessor}}" reads or writes table "{{model}}", which "{{owner}}" owns. Add a named grant to TABLE_GRANTS in tools/generators/src/eslint-rules/table-ownership.map.mjs, or ask the owner through its context.',
  foreignRelation:
    '"{{accessor}}" traverses relation "{{field}}" into table "{{model}}", which "{{owner}}" owns. Add a named grant to TABLE_GRANTS in tools/generators/src/eslint-rules/table-ownership.map.mjs, or ask the owner through its context.',
  foreignRawTable:
    '"{{accessor}}" uses table "{{table}}" in raw SQL, which "{{owner}}" owns. Add a named grant to TABLE_GRANTS in tools/generators/src/eslint-rules/table-ownership.map.mjs, or ask the owner through its context.',
  readOnlyGrant:
    '"{{accessor}}" writes table "{{model}}" through a read-only grant. Writes stay with the owner "{{owner}}" unless the grant says "write".',
};

export function createTableOwnershipRule({ models, owners, grants }) {
  const { modelByDelegate, modelByTable, relationFieldNames } = indexSchema(models);

  function ownerOf(model) {
    const owner = owners[model];
    if (!owner) throw new Error(`Prisma model "${model}" has no owner in TABLE_OWNERS.`);
    return owner;
  }

  function violationOf(accessor, model, mode) {
    const owner = ownerOf(model);
    if (owner === accessor) return undefined;
    const grant = grants.find((entry) => entry.accessor === accessor && entry.model === model);
    if (!grant) return { owner, readOnly: false };
    if (mode === 'write' && grant.access !== 'write') return { owner, readOnly: true };
    return undefined;
  }

  return {
    meta: { type: 'problem', schema: [], messages },
    create(context) {
      const accessor = accessorOf(context.filename ?? context.physicalFilename);
      if (!accessor) return {};
      const services = context.sourceCode.parserServices;
      if (!services?.program || !services.esTreeNodeToTSNodeMap) {
        throw new Error(
          `prisma-table-ownership needs type information for ${context.filename}: lint the file with parserOptions.projectService.`,
        );
      }
      const checker = services.program.getTypeChecker();
      const tsNodeOf = (node) => services.esTreeNodeToTSNodeMap.get(node);

      function receiverIsPrismaClient(objectNode) {
        const type = checker.getTypeAtLocation(tsNodeOf(objectNode));
        return declaredInPrismaClient(checker.getPropertyOfType(type, CLIENT_MARKER));
      }

      function report(node, model, mode, foreign) {
        const violation = violationOf(accessor, model, mode);
        if (!violation) return;
        const data = { accessor, model, owner: violation.owner, ...foreign.data };
        context.report({
          node,
          messageId: violation.readOnly ? 'readOnlyGrant' : foreign.messageId,
          data,
        });
      }

      const reportedRelations = new Set();

      function reportRelation(property, field, matches) {
        if (!relationFieldNames.has(field) || reportedRelations.has(property)) return;
        const relation = relationOfMatches(models, matches, field);
        if (!relation) return;
        reportedRelations.add(property);
        report(property.key, relation.target, relation.mode, {
          messageId: 'foreignRelation',
          data: { field },
        });
      }

      const walker = createTypeWalker({
        checker,
        sourceCode: context.sourceCode,
        visitProperty: reportRelation,
      });

      function delegateArgumentTypes(call) {
        const signature = checker.getResolvedSignature(tsNodeOf(call));
        const constraint = signature?.getDeclaration()?.typeParameters?.[0]?.constraint;
        if (constraint) return flattenTypes([checker.getTypeFromTypeNode(constraint)]);
        const [parameter] = signature?.getParameters() ?? [];
        if (!parameter) return [];
        return flattenTypes([checker.getNonNullableType(checker.getTypeOfSymbol(parameter))]);
      }

      function checkDelegateArguments(memberNode) {
        const methodNode = memberNode.parent;
        const call = methodNode?.parent;
        if (call?.type !== 'CallExpression' || call.callee !== methodNode) return;
        const [argument] = call.arguments;
        if (argument) walker.walk(argument, delegateArgumentTypes(call));
      }

      function checkDelegate(node, model) {
        if (!receiverIsPrismaClient(node.object)) return;
        report(node.property, model, delegateAccessMode(node), {
          messageId: 'foreignDelegate',
          data: {},
        });
        checkDelegateArguments(node);
      }

      function checkDestructuredDelegates(declarator) {
        if (!receiverIsPrismaClient(declarator.init)) return;
        for (const property of declarator.id.properties) {
          if (property.type !== 'Property') continue;
          const model = modelByDelegate.get(propertyKeyName(property));
          if (!model) continue;
          report(property.key, model, 'write', { messageId: 'foreignDelegate', data: {} });
        }
      }

      function checkRawSql(node, methodMode) {
        if (!receiverIsPrismaClient(node.object)) return;
        for (const [table, mode] of rawSqlTables(rawSqlText(node), methodMode)) {
          const model = modelByTable.get(table);
          if (!model) continue;
          report(node.property, model, mode, { messageId: 'foreignRawTable', data: { table } });
        }
      }

      function checkContextualRelation(property) {
        const field = propertyKeyName(property);
        if (!field || !relationFieldNames.has(field)) return;
        const contextual = checker.getContextualType(tsNodeOf(property.parent));
        if (!contextual) return;
        reportRelation(property, field, walker.propertyMatches(flattenTypes([contextual]), field));
      }

      return {
        MemberExpression(node) {
          const name = memberName(node);
          if (!name) return;
          const model = modelByDelegate.get(name);
          if (model) {
            checkDelegate(node, model);
            return;
          }
          const rawMode = RAW_METHODS.get(name);
          if (rawMode) checkRawSql(node, rawMode);
        },
        VariableDeclarator(node) {
          if (node.id.type === 'ObjectPattern' && node.init) checkDestructuredDelegates(node);
        },
        Property(node) {
          if (node.parent?.type === 'ObjectExpression') checkContextualRelation(node);
        },
      };
    },
  };
}

export default createTableOwnershipRule({
  models: loadPrismaSchema(),
  owners: TABLE_OWNERS,
  grants: TABLE_GRANTS,
});
