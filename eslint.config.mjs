// @ts-check
import nxPlugin from '@nx/eslint-plugin';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

// @nx/eslint-plugin ships tseslint-flavoured flat configs; defineConfig's stricter
// ConfigWithExtends doesn't accept them nominally, so widen once at the boundary.
const nxConfigs = /** @type {import('eslint').Linter.Config[]} */ ([
  ...nxPlugin.configs['flat/base'],
  ...nxPlugin.configs['flat/typescript'],
]);

export default defineConfig(
  ...nxConfigs,

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
    extends: [
      // Correctness-focused, not strictTypeChecked: the latter's stylistic rules
      // (no-extraneous-class on every @Module(), dot-notation vs our process.env['X'])
      // fight this stack. High-value strict rules are re-enabled individually below.
      ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.base.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A type-only interface imported as a value leaks into swc's design:paramtypes.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': [
        'error',
        { ignorePrimitives: { string: true, boolean: true } },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      eqeqeq: ['error', 'smart'],
      // Only ever fires on numeric HttpStatus comparisons here (no string enums), where comparing a
      // status number to an HttpStatus member is safe and idiomatic — pure noise, off.
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      // Deprecated API usage is tech debt with a known migration path — fail the build so it
      // never silently accumulates. Type-aware: reads @deprecated JSDoc from our own symbols and
      // library .d.ts alike (Zod, NestJS, Prisma, …). Relies on parserOptions.project above.
      '@typescript-eslint/no-deprecated': 'error',
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
      // Core hygiene applies to tests too, but not the type-aware preset — mocks legitimately
      // lean on `any`/non-null assertions that would otherwise drown tests in noise.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
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
