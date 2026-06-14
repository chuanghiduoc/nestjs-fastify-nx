/**
 * OpenTelemetry SDK bootstrap for the cron scheduler. Must be imported at
 * the very top of `main.ts` so the SDK patches native modules
 * (`http`/`pg`/`ioredis`/etc.) before Nest or @nestjs/schedule resolve them.
 *
 * The SDK is a no-op unless `OTEL_ENABLED=true`.
 */
import { startTracing } from '@nestjs-fastify-nx/infra-observability';

startTracing({ serviceName: 'nestjs-fastify-scheduler' });
