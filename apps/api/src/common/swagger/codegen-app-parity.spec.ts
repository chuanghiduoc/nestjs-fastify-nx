import { describe, it, expect } from 'vitest';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AppModule } from '../../app/app.module';
import { CodegenAppModule } from './codegen-app.module';

// Modules deliberately absent from CodegenAppModule. Documented in
// codegen-app.module.ts header and apps/api CLAUDE.md notes.
//
// Why each one is excluded:
//   - SentryModule        — would init Sentry client + start spans during spec build
//   - GraphqlModule       — Mercurius opens its own HTTP listener
//   - WebsocketModule     — Socket.io adapter would start emitting
//   - MetricsModule       — only loaded when ENABLE_METRICS=true
const KNOWN_EXCLUSIONS_FROM_CODEGEN = new Set<string>([
  'SentryModule',
  'GraphqlModule',
  'WebsocketModule',
  'MetricsModule',
]);

type ModuleRef = { module?: { name: string }; name?: string } | { name: string };

function resolveModuleName(entry: unknown): string {
  if (!entry) return 'unknown';
  if (typeof entry === 'function') return entry.name || 'unknown';
  if (typeof entry === 'object') {
    const ref = entry as ModuleRef;
    if ('module' in ref && ref.module?.name) return ref.module.name;
    if ('name' in ref && typeof ref.name === 'string') return ref.name;
  }
  return 'unknown';
}

function moduleNamesOf(target: object): Set<string> {
  const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, target) ?? []) as unknown[];
  return new Set(imports.map(resolveModuleName));
}

describe('CodegenAppModule parity with AppModule', () => {
  it('every shared AppModule import is present in CodegenAppModule', () => {
    const appNames = moduleNamesOf(AppModule);
    const codegenNames = moduleNamesOf(CodegenAppModule);

    const missing = [...appNames].filter(
      (name) => !codegenNames.has(name) && !KNOWN_EXCLUSIONS_FROM_CODEGEN.has(name),
    );

    expect(
      missing,
      `CodegenAppModule is missing modules that ship in AppModule. ` +
        `Either add them to apps/api/src/common/swagger/codegen-app.module.ts ` +
        `or whitelist them in KNOWN_EXCLUSIONS_FROM_CODEGEN with a justification.`,
    ).toEqual([]);
  });

  it('CodegenAppModule does not silently ship modules absent from AppModule', () => {
    const appNames = moduleNamesOf(AppModule);
    const codegenNames = moduleNamesOf(CodegenAppModule);

    const extra = [...codegenNames].filter((name) => !appNames.has(name));

    expect(
      extra,
      'CodegenAppModule imports modules AppModule does not. The exported spec would ' +
        'document endpoints the runtime API does not serve.',
    ).toEqual([]);
  });
});
