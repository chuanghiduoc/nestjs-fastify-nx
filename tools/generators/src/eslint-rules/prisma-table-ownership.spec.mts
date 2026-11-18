import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Linter, RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { createTableOwnershipRule, rawSqlTables } from './prisma-table-ownership.mjs';
import { loadPrismaSchema } from './prisma-schema.mjs';
import { TABLE_OWNERS, type TableGrant } from './table-ownership.map.mjs';

const FIXTURE_ROOT = fileURLToPath(new URL('./__fixtures__/table-ownership', import.meta.url));
const MODULE_CLIENT = '../../../../generated/prisma/client';
const APP_CLIENT = '../../../generated/prisma/client';

const BASE_GRANTS: readonly TableGrant[] = [
  { accessor: 'modules/organizations', model: 'User', access: 'read', reason: 'fixture' },
  { accessor: 'apps/scheduler', model: 'User', access: 'write', reason: 'fixture' },
];

const MEMBERSHIP_GRANT: TableGrant = {
  accessor: 'modules/users',
  model: 'Member',
  access: 'read',
  reason: 'fixture',
};

function ruleWith(grants: readonly TableGrant[]) {
  return createTableOwnershipRule({ models: loadPrismaSchema(), owners: TABLE_OWNERS, grants });
}

function fixtureFile(relativePath: string): string {
  return join(FIXTURE_ROOT, relativePath);
}

const USERS_FILE = fixtureFile('libs/modules/src/users/sample.ts');
const ORGANIZATIONS_FILE = fixtureFile('libs/modules/src/organizations/sample.ts');
const SCHEDULER_FILE = fixtureFile('apps/scheduler/src/sample.ts');
const INFRA_FILE = fixtureFile('libs/infra/src/auth/sample.ts');
const FEATURE_FLAGS_FILE = fixtureFile('libs/modules/src/feature-flags/sample.ts');

function moduleCode(body: string): string {
  return `import type { PrismaClient, TransactionClient, UserWhereInput } from '${MODULE_CLIENT}';
declare const db: PrismaClient;
declare const tx: TransactionClient;
export async function run(): Promise<unknown> {
  const unused: UserWhereInput | undefined = undefined;
  void unused;
  ${body}
}
`;
}

function appCode(body: string): string {
  return `import type { PrismaClient } from '${APP_CLIENT}';
declare const db: PrismaClient;
export async function run(): Promise<unknown> {
  ${body}
}
`;
}

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      projectService: {
        allowDefaultProject: [
          'libs/modules/src/*/*.ts',
          'libs/infra/src/*/*.ts',
          'apps/*/src/*.ts',
        ],
        defaultProject: 'tsconfig.fixture.json',
      },
      tsconfigRootDir: FIXTURE_ROOT,
    },
  },
});

ruleTester.run('libs-groups/prisma-table-ownership', ruleWith(BASE_GRANTS), {
  valid: [
    { code: moduleCode('return db.user.findMany();'), filename: USERS_FILE },
    { code: moduleCode('return tx.user.findMany();'), filename: USERS_FILE },
    {
      code: moduleCode("return db.user.findUnique({ where: { id: 'u' } });"),
      filename: ORGANIZATIONS_FILE,
    },
    { code: appCode('return db.user.deleteMany({});'), filename: SCHEDULER_FILE },
    {
      code: moduleCode('return db.$queryRaw`SELECT "id" FROM "users"`;'),
      filename: USERS_FILE,
    },
    {
      code: moduleCode(
        "const session = { user: { id: 'u' } }; const req = { user: { id: 'u' } }; const dto = { team: 't' }; return [session.user.id, req.user.id, dto.team];",
      ),
      filename: USERS_FILE,
    },
    {
      code: moduleCode('const summary = { memberships: [] }; return summary;'),
      filename: USERS_FILE,
    },
    { code: moduleCode('return db.featureFlag.findMany();'), filename: INFRA_FILE },
    { code: moduleCode("return db.user['findMany']();"), filename: ORGANIZATIONS_FILE },
    {
      code: moduleCode('const users = db.user; return users.deleteMany({});'),
      filename: USERS_FILE,
    },
    {
      code: moduleCode('return db.$queryRaw`SELECT id AS "users" FROM feature_flags`;'),
      filename: FEATURE_FLAGS_FILE,
    },
    {
      code: moduleCode(
        'return db.$executeRaw`UPDATE organizations o SET name = u.name FROM users u WHERE u.id = o.id`;',
      ),
      filename: ORGANIZATIONS_FILE,
    },
  ],
  invalid: [
    {
      code: moduleCode('return db.featureFlag.findMany();'),
      filename: USERS_FILE,
      errors: [{ messageId: 'foreignDelegate' }],
    },
    {
      code: moduleCode('return tx.member.findMany();'),
      filename: USERS_FILE,
      errors: [{ messageId: 'foreignDelegate' }],
    },
    {
      code: appCode('return db.featureFlag.findMany();'),
      filename: SCHEDULER_FILE,
      errors: [{ messageId: 'foreignDelegate' }],
    },
    {
      code: moduleCode("return db['featureFlag'].findMany();"),
      filename: USERS_FILE,
      errors: [{ messageId: 'foreignDelegate' }],
    },
    {
      code: moduleCode('const { member } = tx; return member.findMany();'),
      filename: USERS_FILE,
      errors: [{ messageId: 'foreignDelegate' }],
    },
    {
      code: moduleCode('const { user } = db; return user.findMany();'),
      filename: ORGANIZATIONS_FILE,
      errors: [{ messageId: 'readOnlyGrant' }],
    },
    {
      code: moduleCode("return db.user.create({ data: { email: 'a@b.c' } });"),
      filename: ORGANIZATIONS_FILE,
      errors: [{ messageId: 'readOnlyGrant' }],
    },
    {
      code: moduleCode("return db.user['update']({ where: { id: 'u' }, data: { name: 'n' } });"),
      filename: ORGANIZATIONS_FILE,
      errors: [{ messageId: 'readOnlyGrant' }],
    },
    {
      code: moduleCode('const users = db.user; return users.deleteMany({});'),
      filename: ORGANIZATIONS_FILE,
      errors: [{ messageId: 'readOnlyGrant' }],
    },
    {
      code: moduleCode('const users = db.user; return users.findMany();'),
      filename: ORGANIZATIONS_FILE,
      errors: [{ messageId: 'readOnlyGrant' }],
    },
    {
      code: moduleCode("return db.$executeRawUnsafe('TRUNCATE users');"),
      filename: ORGANIZATIONS_FILE,
      errors: [{ messageId: 'readOnlyGrant' }],
    },
    {
      code: moduleCode(
        "return db.$executeRaw`UPDATE users u SET name = o.name FROM organizations o WHERE o.id = 'o'`;",
      ),
      filename: ORGANIZATIONS_FILE,
      errors: [{ messageId: 'readOnlyGrant' }],
    },
    {
      code: moduleCode('return db.$queryRaw`SELECT 1 FROM members m, "feature_flags" f`;'),
      filename: USERS_FILE,
      errors: [{ messageId: 'foreignRawTable' }, { messageId: 'foreignRawTable' }],
    },
    {
      code: moduleCode(
        "const where: UserWhereInput = { memberships: { some: { organizationId: 'o' } } }; return db.user.findMany({ where });",
      ),
      filename: USERS_FILE,
      errors: [{ messageId: 'foreignRelation' }],
    },
    {
      code: moduleCode(
        "return db.user.findMany({ where: { memberships: { some: { organizationId: 'o' } } } });",
      ),
      filename: USERS_FILE,
      errors: [{ messageId: 'foreignRelation' }],
    },
    {
      code: moduleCode(
        'return db.user.findMany({ include: { memberships: { select: { role: true } } } });',
      ),
      filename: USERS_FILE,
      errors: [{ messageId: 'foreignRelation' }],
    },
    {
      code: moduleCode('return db.user.findMany({ select: { id: true, memberships: true } });'),
      filename: USERS_FILE,
      errors: [{ messageId: 'foreignRelation' }],
    },
    {
      code: moduleCode(
        'const include = { memberships: true }; return db.user.findMany({ include });',
      ),
      filename: USERS_FILE,
      errors: [{ messageId: 'foreignRelation' }],
    },
    {
      code: moduleCode(
        'const scoped = Math.random() > 0.5; return db.user.findMany({ where: { ...(scoped ? { memberships: { some: {} } } : {}), OR: [{ memberships: { none: {} } }] } });',
      ),
      filename: USERS_FILE,
      errors: [{ messageId: 'foreignRelation' }, { messageId: 'foreignRelation' }],
    },
    {
      code: moduleCode('return db.$queryRaw`SELECT "key" FROM "feature_flags"`;'),
      filename: USERS_FILE,
      errors: [{ messageId: 'foreignRawTable' }],
    },
    {
      code: appCode(
        'return db.$executeRawUnsafe(\'DELETE FROM "members" WHERE "role" = $1\', \'x\');',
      ),
      filename: SCHEDULER_FILE,
      errors: [{ messageId: 'foreignRawTable' }],
    },
    {
      code: moduleCode('return db.$executeRaw`DELETE FROM "users"`;'),
      filename: ORGANIZATIONS_FILE,
      errors: [{ messageId: 'readOnlyGrant' }],
    },
    {
      code: moduleCode(
        "return db.$queryRawUnsafe('DELETE FROM users WHERE id = $1 RETURNING id', 'u');",
      ),
      filename: ORGANIZATIONS_FILE,
      errors: [{ messageId: 'readOnlyGrant' }],
    },
    {
      code: appCode(
        'return db.$queryRaw`SELECT sf.id FROM stored_files sf LEFT JOIN organizations o ON o.id = sf."organizationId"`;',
      ),
      filename: SCHEDULER_FILE,
      errors: [{ messageId: 'foreignRawTable' }, { messageId: 'foreignRawTable' }],
    },
  ],
});

describe('rawSqlTables', () => {
  it('collects the names in table positions, quoted or not', () => {
    expect(
      rawSqlTables(
        'SELECT MIN("createdAt") AS "users" FROM "outbox_events" o JOIN public.members m ON true',
        'read',
      ),
    ).toEqual(
      new Map([
        ['outbox_events', 'read'],
        ['members', 'read'],
      ]),
    );
  });

  it('collects every table of a comma-separated list', () => {
    expect([
      ...rawSqlTables('SELECT 1 FROM members m, "users" AS u, teams', 'read').keys(),
    ]).toEqual(['members', 'users', 'teams']);
    expect(rawSqlTables('TRUNCATE members, "users"', 'write')).toEqual(
      new Map([
        ['members', 'write'],
        ['users', 'write'],
      ]),
    );
  });

  it('marks only the written table of a read method as written', () => {
    const tables = rawSqlTables(
      'DELETE FROM "organization_roles" WHERE "id" IN (SELECT "id" FROM members)',
      'read',
    );
    expect(tables.get('organization_roles')).toBe('write');
    expect(tables.get('members')).toBe('read');
  });

  it('marks only the written table of an execute method as written', () => {
    const tables = rawSqlTables(
      'UPDATE organizations o SET name = u.name FROM users u WHERE u.id = o.id',
      'write',
    );
    expect(tables).toEqual(
      new Map([
        ['organizations', 'write'],
        ['users', 'read'],
      ]),
    );
  });

  it('marks an unquoted truncate target as written', () => {
    expect(rawSqlTables('TRUNCATE users', 'write')).toEqual(new Map([['users', 'write']]));
    expect(rawSqlTables('TRUNCATE TABLE ONLY "users" CASCADE', 'read')).toEqual(
      new Map([['users', 'write']]),
    );
  });

  it('marks an altered or dropped table as written', () => {
    expect(rawSqlTables('ALTER TABLE users DISABLE TRIGGER t', 'read')).toEqual(
      new Map([['users', 'write']]),
    );
    expect(rawSqlTables('DROP TABLE IF EXISTS public."audit_logs_2026_01"', 'read')).toEqual(
      new Map([['audit_logs_2026_01', 'write']]),
    );
  });

  it('marks every table of an execute method with no recognised write target as written', () => {
    expect(rawSqlTables('SELECT 1 FROM members', 'write').get('members')).toBe('write');
  });
});

ruleTester.run(
  'libs-groups/prisma-table-ownership (declared membership grant)',
  ruleWith([...BASE_GRANTS, MEMBERSHIP_GRANT]),
  {
    valid: [
      {
        code: moduleCode(
          "const where: UserWhereInput = { memberships: { some: { organizationId: 'o' } } }; return db.user.findMany({ where, include: { memberships: { select: { role: true } } } });",
        ),
        filename: USERS_FILE,
      },
    ],
    invalid: [
      {
        code: moduleCode(
          "return db.user.create({ data: { email: 'a@b.c', memberships: { create: [{ organizationId: 'o' }] } } });",
        ),
        filename: USERS_FILE,
        errors: [{ messageId: 'readOnlyGrant' }],
      },
      {
        code: moduleCode(
          "return db.user.update({ where: { id: 'u' }, data: { memberships: { create: [{ organizationId: 'o' }] } } });",
        ),
        filename: USERS_FILE,
        errors: [{ messageId: 'readOnlyGrant' }],
      },
    ],
  },
);

describe('prisma-table-ownership without type information', () => {
  it('fails loud instead of silently skipping the file', () => {
    const linter = new Linter();
    const config = {
      files: ['**/*.ts'],
      languageOptions: { parser: tseslint.parser },
      plugins: { ownership: { rules: { 'prisma-table-ownership': ruleWith(BASE_GRANTS) } } },
      rules: { 'ownership/prisma-table-ownership': 'error' as const },
    };

    expect(() =>
      linter.verify(moduleCode('return db.user.findMany();'), config, { filename: USERS_FILE }),
    ).toThrow(/type information/);
  });
});
