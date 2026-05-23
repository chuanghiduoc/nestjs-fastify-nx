import { DynamicModule, Module, Logger } from '@nestjs/common';
import {
  AcceptLanguageResolver,
  HeaderResolver,
  I18nJsonLoader,
  I18nModule,
  QueryResolver,
} from 'nestjs-i18n';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface I18nInfraModuleOptions {
  // Override only when shipping translations from a non-standard layout. Default search order covers dist (production), source (dev/tests), and Docker working-dir copies.
  readonly translationsPath?: string;
  readonly fallbackLanguage?: string;
  readonly watch?: boolean;
}

// Search order matches the way `node` is launched in each environment:
//   - `nx serve api` / local prod build:    dist/apps/api/assets/i18n (cwd = workspace root)
//   - Docker production image:              dist/assets/i18n         (Dockerfile flattens dist/apps/api/* to /app/dist/)
//   - vitest / e2e / source-only:           apps/api/src/assets/i18n
//   - Generic deploy:                       assets/i18n              (cwd = app root)
function resolveDefaultTranslationsPath(): string {
  const candidates = [
    path.join(process.cwd(), 'dist/apps/api/assets/i18n'),
    path.join(process.cwd(), 'dist/assets/i18n'),
    path.join(process.cwd(), 'apps/api/src/assets/i18n'),
    path.join(process.cwd(), 'assets/i18n'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

@Module({})
export class I18nInfraModule {
  static forRoot(options: I18nInfraModuleOptions = {}): DynamicModule {
    const translationsPath = options.translationsPath ?? resolveDefaultTranslationsPath();
    const fallbackLanguage = options.fallbackLanguage ?? 'en';
    const watch = options.watch ?? process.env['NODE_ENV'] !== 'production';

    if (!fs.existsSync(translationsPath)) {
      new Logger('I18nInfraModule').warn(
        `Translations path "${translationsPath}" does not exist — translation lookups will fall back to keys.`,
      );
    }

    return {
      module: I18nInfraModule,
      imports: [
        I18nModule.forRoot({
          fallbackLanguage,
          loaderOptions: {
            path: translationsPath,
            watch,
          },
          loader: I18nJsonLoader,
          // Order matters: explicit `?lang=` wins (dev/testing), `x-lang` header for SPAs that can't set Accept-Language reliably, Accept-Language is the REST standard.
          resolvers: [
            new QueryResolver(['lang']),
            new HeaderResolver(['x-lang']),
            new AcceptLanguageResolver(),
          ],
          // Type-safe key generation is opt-in — we ship our own constants in `i18n-keys.ts`.
          typesOutputPath: undefined,
          logging: false,
        }),
      ],
      exports: [I18nModule],
    };
  }
}
