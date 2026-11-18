import { readFileSync } from 'node:fs';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import rule, { CONTRACT_EDGES, INFRA_EDGES, findEdgeCycle } from './no-cross-context-imports.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
});

const MODULES = '@nestjs-fastify-nx/modules';
const INFRA = '@nestjs-fastify-nx/infra';

ruleTester.run('libs-groups/no-cross-context-imports', rule, {
  valid: [
    {
      code: `import { UsersModule } from '${MODULES}/users';`,
      filename: 'apps/api/src/app/app.module.ts',
    },
    {
      code: `import { ListUsersCursorQuery } from '${MODULES}/users';`,
      filename: 'libs/composition/admin/src/presentation/controllers/admin-users.controller.ts',
    },
    {
      code: `import { UsersModule } from '${MODULES}';`,
      filename: 'libs/modules/src/users/users.module.ts',
    },
    {
      code: `import { SessionsController } from './sessions.controller';`,
      filename: 'libs/modules/src/sessions/sessions.module.ts',
    },
    {
      code: `import { UsersModule } from '${MODULES}';`,
      filename: 'D:/nestjs-fastify-nx/libs/modules/src/users/users.module.ts',
    },
    {
      code: `import { SessionsModule } from '${MODULES}/sessions';`,
      filename:
        '/home/runner/work/nestjs-fastify-nx/nestjs-fastify-nx/libs/modules/src/sessions/sessions.module.ts',
    },
    {
      code: `import { UserRepositoryPort } from '../../domain/ports/user-repository.port';`,
      filename: 'D:/repo/libs/modules/src/users/application/queries/get-user-profile.ts',
    },
    {
      code: `import { PrismaService } from '${INFRA}/database';`,
      filename: 'libs/infra/src/auth/lib/better-auth.config.ts',
    },
    {
      code: `import { PrismaService } from '${INFRA}/database';`,
      filename: 'libs/modules/src/users/infrastructure/repositories/prisma-user.repository.ts',
    },
    {
      code: `import { InMemoryAuthorizationAdapter } from '${INFRA}/authorization/testing';`,
      filename: 'apps/api/e2e/test-app.ts',
    },
    {
      code: `import { resolveRequestLocale } from '../../i18n';`,
      filename: 'libs/infra/src/auth/lib/better-auth.guard.ts',
    },
    {
      code: `import { AuthModule } from '../auth';`,
      filename: 'libs/infra/src/authorization/lib/authorization.module.ts',
    },
    {
      code: `import { ModulesGroup } from '../index';`,
      filename: 'libs/modules/src/users/users.module.ts',
    },
    {
      code: 'const mod = await import(`./users.controller`);',
      filename: 'libs/modules/src/users/users.module.ts',
    },
  ],
  invalid: [
    {
      code: `import { SessionsController } from '${MODULES}/sessions';`,
      filename: 'libs/modules/src/users/users.module.ts',
      errors: [{ messageId: 'crossContext' }],
    },
    {
      code: `import { ListMySessionsQuery } from '${MODULES}/sessions/list-my-sessions';`,
      filename: 'apps/api/src/app/app.module.ts',
      errors: [{ messageId: 'deepImport' }],
    },
    {
      code: `import { ListUsersCursorQuery } from '${MODULES}/users/queries/list-users-cursor';`,
      filename: 'libs/modules/src/sessions/sessions.module.ts',
      errors: [{ messageId: 'deepImport' }],
    },
    {
      code: `import { UsersModule } from '${MODULES}';`,
      filename: 'apps/api/src/app/app.module.ts',
      errors: [{ messageId: 'rootOutsideGroup' }],
    },
    {
      code: `const mod = await import('${MODULES}/sessions');`,
      filename: 'libs/modules/src/users/users.module.ts',
      errors: [{ messageId: 'crossContext' }],
    },
    {
      code: `export { SessionsController } from '${MODULES}/sessions';`,
      filename: 'libs/modules/src/users/users.module.ts',
      errors: [{ messageId: 'crossContext' }],
    },
    {
      code: `import { SessionsService } from '${MODULES}/sessions';`,
      filename: 'C:\\repo\\libs\\modules\\src\\users\\users.module.ts',
      errors: [{ messageId: 'crossContext' }],
    },
    {
      code: `import { SessionsService } from '${MODULES}/sessions';`,
      filename:
        '/home/runner/work/nestjs-fastify-nx/nestjs-fastify-nx/libs/modules/src/users/users.module.ts',
      errors: [{ messageId: 'crossContext' }],
    },
    {
      code: `import { ModulesGroup } from '${MODULES}';`,
      filename: 'D:/repo/apps/api/src/app/app.module.ts',
      errors: [{ messageId: 'rootOutsideGroup' }],
    },
    {
      code: `import { AuditLog } from '../../../audit-log/domain/entities/audit-log.entity';`,
      filename: 'D:/repo/libs/modules/src/users/domain/entities/user.entity.ts',
      errors: [{ messageId: 'crossContext' }],
    },
    {
      code: `import { SessionsModule } from '../../../sessions/sessions.module';`,
      filename: 'libs/modules/src/users/presentation/controllers/users.controller.ts',
      errors: [{ messageId: 'crossContext' }],
    },
    {
      code: `import { OrganizationsModule } from '../organizations';`,
      filename: 'libs/modules/src/users/users.module.ts',
      errors: [{ messageId: 'crossContext' }],
    },
    {
      code: `import { OrganizationsModule } from '../organizations/';`,
      filename: 'libs/modules/src/users/users.module.ts',
      errors: [{ messageId: 'crossContext' }],
    },
    {
      code: `import { OrganizationsModule } from '../../../organizations';`,
      filename: 'libs/modules/src/users/application/queries/list-users-cursor.ts',
      errors: [{ messageId: 'crossContext' }],
    },
    {
      code: `import { AuthModule } from '${INFRA}/auth';`,
      filename: 'libs/infra/src/database/lib/prisma.service.ts',
      errors: [{ messageId: 'crossContext' }],
    },
    {
      code: `import { StoragePort } from '${INFRA}/storage';`,
      filename: 'libs/infra/src/auth/lib/better-auth.config.ts',
      errors: [{ messageId: 'crossContext' }],
    },
    {
      code: `import { PrismaService } from '${INFRA}/database/lib/prisma.service';`,
      filename: 'libs/infra/src/auth/lib/better-auth.config.ts',
      errors: [{ messageId: 'deepImport' }],
    },
    {
      code: `import { AuthModule } from '../../auth';`,
      filename: 'libs/infra/src/database/lib/prisma.service.ts',
      errors: [{ messageId: 'crossContext' }],
    },
    {
      code: `import { InfraGroup } from '${INFRA}';`,
      filename: 'apps/api/src/app/app.module.ts',
      errors: [{ messageId: 'rootOutsideGroup' }],
    },
  ],
});

ruleTester.run('libs-groups/no-cross-context-imports (published contracts)', rule, {
  valid: [
    {
      code: `import { organizationMemberAddedPayloadSchema } from '${MODULES}/organizations/contract';`,
      filename: 'libs/modules/src/notifications/membership-notification.listener.ts',
    },
    {
      code: `import { organizationMemberAddedPayloadSchema } from '${MODULES}/organizations/contract';`,
      filename: 'apps/worker/src/app/app.module.ts',
    },
    {
      code: `import { featureFlagCreatedPayloadSchema } from '${MODULES}/feature-flags/contract';`,
      filename: 'libs/composition/admin/src/presentation/controllers/admin.controller.ts',
    },
    {
      code: `import { userRegisteredPayloadSchema } from '../../contract';`,
      filename: 'libs/modules/src/users/application/listeners/user-registered.listener.ts',
    },
    {
      code: `import { z } from 'zod';`,
      filename: 'libs/modules/src/users/contract/user-events.ts',
    },
    {
      code: `import { DOMAIN_EVENTS } from '@nestjs-fastify-nx/shared';`,
      filename: 'libs/modules/src/users/contract/user-events.ts',
    },
    {
      code: `export { userRegisteredPayloadSchema } from './user-events';`,
      filename: 'libs/modules/src/users/contract/index.ts',
    },
  ],
  invalid: [
    {
      code: `import { featureFlagCreatedPayloadSchema } from '${MODULES}/feature-flags/contract';`,
      filename: 'libs/modules/src/notifications/membership-notification.listener.ts',
      errors: [{ messageId: 'undeclaredContractEdge' }],
    },
    {
      code: `import { OrganizationsModule } from '${MODULES}/organizations';`,
      filename: 'libs/modules/src/notifications/membership-notification.listener.ts',
      errors: [{ messageId: 'crossContext' }],
    },
    {
      code: `import { schema } from '${MODULES}/organizations/contract/organization-events';`,
      filename: 'libs/modules/src/notifications/membership-notification.listener.ts',
      errors: [{ messageId: 'deepImport' }],
    },
    {
      code: `import { schema } from '${MODULES}/organizations/contract/organization-events';`,
      filename: 'apps/api/src/app/app.module.ts',
      errors: [{ messageId: 'deepImport' }],
    },
    {
      code: `import { organizationMemberAddedPayloadSchema } from '../organizations/contract';`,
      filename: 'libs/modules/src/notifications/membership-notification.listener.ts',
      errors: [{ messageId: 'relativeContractImport' }],
    },
    {
      code: `import { Injectable } from '@nestjs/common';`,
      filename: 'libs/modules/src/users/contract/user-events.ts',
      errors: [{ messageId: 'impureContract' }],
    },
    {
      code: `import { PrismaService } from '${INFRA}/database';`,
      filename: 'libs/modules/src/users/contract/user-events.ts',
      errors: [{ messageId: 'impureContract' }],
    },
    {
      code: `import { UserRole } from '../domain/entities/user.entity';`,
      filename: 'libs/modules/src/users/contract/user-events.ts',
      errors: [{ messageId: 'impureContract' }],
    },
    {
      code: `export * from '@nestjs-fastify-nx/core';`,
      filename: 'libs/modules/src/users/contract/index.ts',
      errors: [{ messageId: 'impureContract' }],
    },
  ],
});

describe('contract edges', () => {
  it('declares an acyclic contract edge map', () => {
    expect(findEdgeCycle(CONTRACT_EDGES)).toBeUndefined();
  });

  it('declares acyclic infra folder edges', () => {
    expect(findEdgeCycle(INFRA_EDGES)).toBeUndefined();
  });

  it('finds a cycle in a cyclic edge map', () => {
    expect(findEdgeCycle({ a: ['b'], b: ['c'], c: ['a'] })).toEqual(['a', 'b', 'c', 'a']);
  });

  it('finds a self edge', () => {
    expect(findEdgeCycle({ a: ['a'] })).toEqual(['a', 'a']);
  });

  it('points every contract edge at a context that publishes a contract', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../../../libs/modules/package.json', import.meta.url), 'utf8'),
    ) as { exports: Record<string, unknown> };
    const targets = Object.values(CONTRACT_EDGES).flat();
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(Object.keys(manifest.exports)).toContain(`./${target}/contract`);
    }
  });
});

const typeScriptRuleTester = new RuleTester({
  languageOptions: { parser: tseslint.parser, ecmaVersion: 'latest', sourceType: 'module' },
});

typeScriptRuleTester.run('libs-groups/no-cross-context-imports (TypeScript syntax)', rule, {
  valid: [
    {
      code: `type Port = import('./users-repository.port').UsersRepositoryPort;`,
      filename: 'libs/modules/src/users/users.module.ts',
    },
    {
      code: `import port = require('./users-repository.port');`,
      filename: 'libs/modules/src/users/users.module.ts',
    },
  ],
  invalid: [
    {
      code: `type Module = import('../sessions/sessions.module').SessionsModule;`,
      filename: 'libs/modules/src/users/users.module.ts',
      errors: [{ messageId: 'crossContext' }],
    },
    {
      code: `type Module = import('${MODULES}/sessions/sessions.module').SessionsModule;`,
      filename: 'apps/api/src/app/app.module.ts',
      errors: [{ messageId: 'deepImport' }],
    },
    {
      code: `import sessions = require('../sessions/sessions.module');`,
      filename: 'libs/modules/src/users/users.module.ts',
      errors: [{ messageId: 'crossContext' }],
    },
    {
      code: 'const mod = await import(`../sessions/sessions.module`);',
      filename: 'libs/modules/src/users/users.module.ts',
      errors: [{ messageId: 'crossContext' }],
    },
    {
      code: 'const mod = await import(`${"@nestjs-fastify-nx/modules"}/sessions`);',
      filename: 'libs/modules/src/users/users.module.ts',
      errors: [{ messageId: 'unresolvableImport' }],
    },
  ],
});
