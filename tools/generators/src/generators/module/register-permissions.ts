import type { Tree } from '@nx/devkit';
import * as ts from 'typescript';

export const PERMISSIONS_FILE = 'libs/shared/src/lib/permissions.ts';
export const ACCESS_POLICY_FILE = 'libs/infra/src/authorization/lib/access-policy.ts';

const ORGANIZATION_SCOPE = 'organization';
const RESOURCE_TYPE_PATTERN = /^[a-z][a-z0-9_]*$/;

export type PermissionAction = 'read' | 'create';

export interface PermissionRegistration {
  readonly constantName: string;
  readonly resourceType: string;
  readonly actions: readonly PermissionAction[];
}

interface CatalogProperty {
  readonly key: string;
  readonly value: string;
}

interface CatalogInsertion {
  readonly file: string;
  readonly variableName: string;
  readonly properties: readonly CatalogProperty[];
  readonly valuesAreUnique: boolean;
}

export function registerPermissions(tree: Tree, registration: PermissionRegistration): void {
  const { constantName, resourceType, actions } = registration;
  if (!RESOURCE_TYPE_PATTERN.test(resourceType)) {
    throw new Error(`Resource type "${resourceType}" must be snake_case.`);
  }

  const sources = new Map<string, string>();
  const insertions: readonly CatalogInsertion[] = [
    {
      file: PERMISSIONS_FILE,
      variableName: 'RESOURCE_TYPES',
      properties: [{ key: constantName, value: `'${resourceType}'` }],
      valuesAreUnique: true,
    },
    {
      file: PERMISSIONS_FILE,
      variableName: 'PERMISSIONS',
      properties: actions.map((action) => ({
        key: `${constantName}_${action.toUpperCase()}`,
        value: `'${resourceType}:${action}'`,
      })),
      valuesAreUnique: true,
    },
    {
      file: ACCESS_POLICY_FILE,
      variableName: 'RESOURCE_SCOPES',
      properties: [{ key: `[RESOURCE_TYPES.${constantName}]`, value: `'${ORGANIZATION_SCOPE}'` }],
      valuesAreUnique: false,
    },
  ];

  for (const insertion of insertions) {
    const source = sources.get(insertion.file) ?? readCatalogFile(tree, insertion.file);
    sources.set(insertion.file, withCatalogProperties(source, insertion));
  }
  for (const [file, source] of sources) {
    tree.write(file, source);
  }
}

function readCatalogFile(tree: Tree, file: string): string {
  const source = tree.read(file, 'utf-8');
  if (source === null) {
    throw new Error(`Cannot register permissions: "${file}" does not exist.`);
  }
  return source;
}

function withCatalogProperties(source: string, insertion: CatalogInsertion): string {
  const { file, variableName, properties } = insertion;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const catalog = findObjectLiteral(sourceFile, variableName);
  if (!catalog) {
    throw new Error(
      `Cannot register permissions: "${variableName}" object not found in "${file}".`,
    );
  }

  assertNoCollision(catalog, sourceFile, insertion);

  const separator =
    catalog.properties.length > 0 && !catalog.properties.hasTrailingComma ? ',' : '';
  const lastPropertyEnd = catalog.properties.end;
  const closingBrace = catalog.getEnd() - 1;
  const addedText = properties.map(({ key, value }) => `  ${key}: ${value},\n`).join('');

  return (
    source.slice(0, lastPropertyEnd) +
    separator +
    source.slice(lastPropertyEnd, closingBrace) +
    addedText +
    source.slice(closingBrace)
  );
}

function findObjectLiteral(
  sourceFile: ts.SourceFile,
  variableName: string,
): ts.ObjectLiteralExpression | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(sourceFile) !== variableName || !declaration.initializer) {
        continue;
      }
      const initializer = unwrapExpression(declaration.initializer);
      return ts.isObjectLiteralExpression(initializer) ? initializer : undefined;
    }
  }
  return undefined;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isParenthesizedExpression(expression)
  ) {
    return unwrapExpression(expression.expression);
  }
  return expression;
}

function assertNoCollision(
  catalog: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  insertion: CatalogInsertion,
): void {
  const { file, variableName, properties, valuesAreUnique } = insertion;
  const existing = catalog.properties.filter(ts.isPropertyAssignment);
  const existingKeys = new Set(existing.map((property) => property.name.getText(sourceFile)));
  const existingValues = new Set(
    existing.map((property) => property.initializer.getText(sourceFile)),
  );

  for (const { key, value } of properties) {
    if (existingKeys.has(key) || (valuesAreUnique && existingValues.has(value))) {
      throw new Error(
        `Cannot register permissions: ${key} / ${value} already exists in ${file} ${variableName}.`,
      );
    }
  }
}
