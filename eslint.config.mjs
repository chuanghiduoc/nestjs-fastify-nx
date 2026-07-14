// @ts-check
import nxPlugin from '@nx/eslint-plugin';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Nx recommended rules (includes module boundaries)
  ...nxPlugin.configs['flat/base'],
  ...nxPlugin.configs['flat/typescript'],

  // Global ignores
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.nx/**',
      '**/coverage/**',
      '**/tmp/**',
      // Tool-generated sources (Orval REST client, etc.) are owned by the
      // generator, not the developer — regenerated on every codegen run and
      // never hand-edited. Linting them only surfaces the generator's stylistic
      // choices (e.g. orval 8.15's escaped `\/` in string literals), which we
      // cannot fix without forking the tool.
      '**/generated/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
    ],
  },

  // TypeScript files — production boundaries
  {
    files: ['**/*.ts'],
    ignores: ['**/*.spec.ts', '**/*.integration.ts', '**/e2e/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.base.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // No `any` in production code — the codebase is currently clean, keep it that way.
      '@typescript-eslint/no-explicit-any': 'error',
      // Unhandled promises are silent data-loss/ordering bugs in an async, event-driven
      // service. Type-aware — relies on the parserOptions.project set above.
      '@typescript-eslint/no-floating-promises': 'error',
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: [
            {
              sourceTag: 'scope:api',
              onlyDependOnLibsWithTags: [
                'scope:modules',
                'scope:composition',
                'scope:core',
                'scope:shared',
                'scope:contracts',
                'scope:infra',
              ],
            },
            {
              sourceTag: 'scope:worker',
              onlyDependOnLibsWithTags: [
                'scope:modules',
                'scope:core',
                'scope:shared',
                'scope:contracts',
                'scope:infra',
              ],
            },
            {
              sourceTag: 'scope:scheduler',
              onlyDependOnLibsWithTags: [
                'scope:modules',
                'scope:core',
                'scope:shared',
                'scope:contracts',
                'scope:infra',
              ],
            },
            {
              // The migration app is a thin CMD wrapper around `prisma migrate
              // deploy` and `prisma/seed.js`. It must NOT pull in domain code
              // — accidentally importing a use-case here would couple schema
              // rollouts to runtime business logic. Empty allow-list enforces
              // that.
              sourceTag: 'scope:migration',
              onlyDependOnLibsWithTags: [],
            },
            {
              sourceTag: 'scope:modules',
              onlyDependOnLibsWithTags: [
                'scope:core',
                'scope:shared',
                'scope:contracts',
                'scope:infra',
              ],
            },
            {
              // Composition modules cross-cut multiple bounded contexts to expose
              // grouped surfaces (admin, BFF, ...). Feature modules MUST NOT
              // depend on these — flow is one-way downward: composition → modules.
              sourceTag: 'scope:composition',
              onlyDependOnLibsWithTags: [
                'scope:modules',
                'scope:composition',
                'scope:core',
                'scope:shared',
                'scope:contracts',
                'scope:infra',
              ],
            },
            {
              sourceTag: 'scope:infra',
              onlyDependOnLibsWithTags: [
                'scope:core',
                'scope:shared',
                'scope:contracts',
                'scope:infra',
              ],
            },
            {
              sourceTag: 'scope:core',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
            {
              sourceTag: 'scope:contracts',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: [],
            },
            {
              sourceTag: 'scope:client',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:contracts'],
            },
            {
              sourceTag: 'scope:tools',
              onlyDependOnLibsWithTags: [],
            },
            {
              sourceTag: 'scope:testing',
              onlyDependOnLibsWithTags: [
                'scope:core',
                'scope:shared',
                'scope:contracts',
                'scope:infra',
                'scope:modules',
              ],
            },
          ],
        },
      ],
    },
  },

  // Application layer stays framework-agnostic (docs/code-standards.md → DTOs): a
  // use-case must be reusable from REST, GraphQL, or a queue consumer, so HTTP/
  // serialization decorators must not leak in. Presentation DTOs own those.
  {
    files: ['**/application/**/*.ts'],
    ignores: ['**/*.spec.ts', '**/*.integration.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@nestjs/swagger',
              message:
                'Swagger decorators belong in presentation/dto only — the application layer must stay framework-agnostic.',
            },
            {
              name: 'class-validator',
              message:
                'Application DTOs are pure TS — class-validator decorators belong in presentation/dto only.',
            },
          ],
        },
      ],
    },
  },

  // Test files — relaxed: allow scope:testing imports
  {
    files: ['**/*.spec.ts', '**/*.integration.ts', '**/e2e/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.base.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
);
