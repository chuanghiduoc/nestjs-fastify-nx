export type TableAccess = 'read' | 'write';

export interface TableGrant {
  readonly accessor: string;
  readonly model: string;
  readonly access: TableAccess;
  readonly reason: string;
}

export declare const TABLE_OWNERS: Readonly<Record<string, string>>;
export declare const TABLE_GRANTS: readonly TableGrant[];
