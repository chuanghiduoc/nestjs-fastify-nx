/**
 * OpenTelemetry SDK bootstrap. Imported at the very top of `main.ts` so the
 * SDK can patch native `http`/`fs`/`pg`/etc. modules **before** Nest, Fastify
 * or Prisma resolve them. Importing it any later would leave already-loaded
 * libraries un-instrumented.
 *
 * The SDK is a no-op unless `OTEL_ENABLED=true`. Endpoints, sampler ratio
 * and headers come straight from environment variables — `env.validation.ts`
 * applies the defaults that Nest's ConfigService later surfaces.
 */
import { startTracing } from '@nestjs-fastify-nx/infra-observability';

// Process-specific fallback; OTEL_SERVICE_NAME overrides it when explicitly configured.
startTracing({ serviceName: 'nestjs-fastify-api' });
