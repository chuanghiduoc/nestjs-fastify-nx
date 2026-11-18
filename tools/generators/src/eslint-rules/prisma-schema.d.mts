export interface PrismaModel {
  readonly table: string;
  readonly relations: ReadonlyMap<string, string>;
}

export type PrismaModels = ReadonlyMap<string, PrismaModel>;

export declare const SCHEMA_URL: URL;
export declare function parsePrismaSchema(text: string): PrismaModels;
export declare function loadPrismaSchema(url?: URL): PrismaModels;
