import { RuleTester } from 'eslint';
import rule from './no-cross-context-imports.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
});

const PACKAGE = '@nestjs-fastify-nx/modules';

ruleTester.run('modules/no-cross-context-imports', rule, {
  valid: [
    {
      code: `import { UsersModule } from '${PACKAGE}/users';`,
      filename: 'apps/api/src/app/app.module.ts',
    },
    {
      code: `import { ListUsersCursorQuery } from '${PACKAGE}/users';`,
      filename: 'libs/composition/admin/src/presentation/controllers/admin-users.controller.ts',
    },
    {
      code: `import { UsersModule } from '${PACKAGE}';`,
      filename: 'libs/modules/src/users.module.ts',
    },
    {
      code: `import { SessionsController } from './sessions.controller';`,
      filename: 'libs/modules/src/sessions/sessions.module.ts',
    },
  ],
  invalid: [
    {
      code: `import { SessionsController } from '${PACKAGE}/sessions';`,
      filename: 'libs/modules/src/users/users.module.ts',
      errors: [{ messageId: 'crossContext', data: { importer: 'users', imported: 'sessions' } }],
    },
    {
      code: `import { ListMySessionsQuery } from '${PACKAGE}/sessions/list-my-sessions';`,
      filename: 'apps/api/src/app/app.module.ts',
      errors: [{ messageId: 'deepImport', data: { context: 'sessions' } }],
    },
    {
      code: `import { ListUsersCursorQuery } from '${PACKAGE}/users/queries/list-users-cursor';`,
      filename: 'libs/modules/src/sessions/sessions.module.ts',
      errors: [{ messageId: 'deepImport', data: { context: 'users' } }],
    },
    {
      code: `import { UsersModule } from '${PACKAGE}';`,
      filename: 'apps/api/src/app/app.module.ts',
      errors: [{ messageId: 'rootOutsideGroup' }],
    },
    {
      code: `const mod = await import('${PACKAGE}/sessions');`,
      filename: 'libs/modules/src/users/users.module.ts',
      errors: [{ messageId: 'crossContext', data: { importer: 'users', imported: 'sessions' } }],
    },
    {
      code: `export { SessionsController } from '${PACKAGE}/sessions';`,
      filename: 'libs/modules/src/users/users.module.ts',
      errors: [{ messageId: 'crossContext', data: { importer: 'users', imported: 'sessions' } }],
    },
  ],
});
