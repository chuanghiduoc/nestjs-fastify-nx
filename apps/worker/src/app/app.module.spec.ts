import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { AppModule } from './app.module';

// Every other worker test constructs its class directly, so a provider that exists in the code but
// is not reachable from the module that injects it compiles, passes unit tests, and only fails when
// Nest wires the graph — i.e. at boot, in a container, after deploy. This test compiles the real
// module graph so that failure surfaces here instead.
describe('worker AppModule', () => {
  let compiled: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;

  beforeAll(async () => {
    // Only the process-external connections are stubbed; the module graph itself stays real.
    vi.spyOn(PrismaService.prototype, 'onModuleInit').mockResolvedValue(undefined);
    vi.spyOn(PrismaService.prototype, 'onModuleDestroy').mockResolvedValue(undefined);

    compiled = await Test.createTestingModule({ imports: [AppModule] }).compile();
  }, 60_000);

  afterAll(async () => {
    await compiled?.close();
    vi.restoreAllMocks();
  });

  // compile() is the assertion: it resolves the whole graph and throws
  // UnknownDependenciesException if any injected token is unreachable from the module that needs
  // it — which is how VerifyUploadHandler could not see MALWARE_SCANNER_PORT.
  it('resolves every dependency, including the scanner port the shared handler injects', () => {
    expect(compiled).toBeDefined();
  });
});
