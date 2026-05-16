import { z } from 'zod';

const workerEnvSchema = z.object({
  // Database (used by domain-event outbox / future audit-log writers if any)
  DATABASE_URL: z.string().trim().min(1).optional(),

  // Redis queue
  REDIS_QUEUE_HOST: z.string().default('localhost'),
  REDIS_QUEUE_PORT: z.coerce.number().int().min(1).max(65535).default(6380),
  REDIS_QUEUE_PREFIX: z.string().default('bull'),

  // Storage (S3 / MinIO) — needed by the upload-verification processor.
  STORAGE_ENDPOINT: z.string().default('http://localhost:9000'),
  STORAGE_BUCKET: z.string().default('uploads'),
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_ACCESS_KEY: z.string().default('minioadmin'),
  STORAGE_SECRET_KEY: z.string().default('minioadmin'),

  // Mail (Nodemailer SMTP)
  MAIL_HOST: z.string().default('localhost'),
  MAIL_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  MAIL_USER: z.string().default(''),
  MAIL_PASSWORD: z.string().default(''),
  MAIL_IGNORE_TLS: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  MAIL_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  MAIL_REQUIRE_TLS: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  MAIL_DEFAULT_EMAIL: z.string().email().default('noreply@example.com'),
  MAIL_DEFAULT_NAME: z.string().default('No Reply'),

  // App
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),

  // OpenTelemetry (read by tracing.ts via process.env directly; included here for
  // completeness and so misconfiguration surfaces at boot rather than at first span)
  OTEL_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  OTEL_SERVICE_NAME: z.string().default('nestjs-fastify-worker'),
  OTEL_SERVICE_NAMESPACE: z.string().default('app'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://localhost:4318'),
  OTEL_EXPORTER_OTLP_HEADERS: z.string().default(''),
  OTEL_TRACES_SAMPLER_RATIO: z.coerce.number().min(0).max(1).default(1),

  // Sentry
  SENTRY_DSN: z.string().optional().default(''),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  SENTRY_ENVIRONMENT: z.string().default('development'),
});

export type WorkerEnvConfig = z.infer<typeof workerEnvSchema>;

export function validateWorkerConfig(config: Record<string, unknown>): WorkerEnvConfig {
  const result = workerEnvSchema.safeParse(config);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Worker environment validation failed. Fix the following variables:\n${formatted}`,
    );
  }

  return result.data;
}
