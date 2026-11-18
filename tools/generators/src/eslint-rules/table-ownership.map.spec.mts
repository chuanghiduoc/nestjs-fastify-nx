import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPrismaSchema, parsePrismaSchema } from './prisma-schema.mjs';
import { TABLE_GRANTS, TABLE_OWNERS } from './table-ownership.map.mjs';

const WORKSPACE_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const ACCESSOR_ROOTS: Readonly<Record<string, string>> = {
  modules: 'libs/modules/src',
  infra: 'libs/infra/src',
  apps: 'apps',
};

function folderExists(accessor: string): boolean {
  const [kind, folder] = accessor.split('/');
  const root = ACCESSOR_ROOTS[kind];
  return Boolean(root && folder) && existsSync(`${WORKSPACE_ROOT}${root}/${folder}`);
}

describe('TABLE_OWNERS', () => {
  const models = loadPrismaSchema();

  it('names an owner for every model in prisma/schema.prisma', () => {
    const unowned = [...models.keys()].filter((model) => !TABLE_OWNERS[model]);
    expect(unowned).toEqual([]);
  });

  it('names no model that the schema does not declare', () => {
    expect(Object.keys(TABLE_OWNERS).filter((model) => !models.has(model))).toEqual([]);
  });

  it('assigns every model to an existing context or infra folder', () => {
    for (const owner of Object.values(TABLE_OWNERS)) {
      expect(owner).toMatch(/^(modules|infra)\//);
      expect(folderExists(owner), owner).toBe(true);
    }
  });
});

describe('TABLE_GRANTS', () => {
  const models = loadPrismaSchema();

  it('grants only declared models to existing contexts or apps', () => {
    for (const grant of TABLE_GRANTS) {
      expect(models.has(grant.model), grant.model).toBe(true);
      expect(grant.accessor).toMatch(/^(modules|apps)\//);
      expect(folderExists(grant.accessor), grant.accessor).toBe(true);
      expect(['read', 'write']).toContain(grant.access);
      expect(grant.reason.trim()).not.toBe('');
    }
  });

  it('never grants a model to its own owner', () => {
    expect(TABLE_GRANTS.filter((grant) => TABLE_OWNERS[grant.model] === grant.accessor)).toEqual(
      [],
    );
  });

  it('declares at most one grant per accessor and model', () => {
    const keys = TABLE_GRANTS.map((grant) => `${grant.accessor}:${grant.model}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('parsePrismaSchema', () => {
  const schema = `
model User {
  id          String   @id
  role        String?
  memberships Member[]
  @@map("users")
}

model Member {
  id     String @id
  userId String
  user   User   @relation(fields: [userId], references: [id])
}
`;

  it('reads the mapped table name and falls back to the model name', () => {
    const models = parsePrismaSchema(schema);
    expect(models.get('User')?.table).toBe('users');
    expect(models.get('Member')?.table).toBe('Member');
  });

  it('keeps only fields whose type is another model as relations', () => {
    const models = parsePrismaSchema(schema);
    expect([...(models.get('User')?.relations ?? [])]).toEqual([['memberships', 'Member']]);
    expect([...(models.get('Member')?.relations ?? [])]).toEqual([['user', 'User']]);
  });

  it('parses the relations of the workspace schema', () => {
    const models = loadPrismaSchema();
    expect(models.get('User')?.relations.get('memberships')).toBe('Member');
    expect(models.get('StoredFile')?.table).toBe('stored_files');
  });
});
