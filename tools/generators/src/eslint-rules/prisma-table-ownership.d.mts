import type { Rule } from 'eslint';
import type { PrismaModels } from './prisma-schema.mjs';
import type { TableAccess, TableGrant } from './table-ownership.map.mjs';

export interface TableOwnershipOptions {
  readonly models: PrismaModels;
  readonly owners: Readonly<Record<string, string>>;
  readonly grants: readonly TableGrant[];
}

export declare function accessorOf(filename: string): string | undefined;
export declare function rawSqlTables(
  sql: string,
  methodMode: TableAccess,
): Map<string, TableAccess>;
export declare function createTableOwnershipRule(options: TableOwnershipOptions): Rule.RuleModule;

declare const rule: Rule.RuleModule;

export default rule;
