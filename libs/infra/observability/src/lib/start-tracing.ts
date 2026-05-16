import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

// `deployment.environment.name` lives in the incubating spec which requires
// `moduleResolution: nodenext`. Inline the literal so this lib stays portable.
const ATTR_DEPLOYMENT_ENVIRONMENT_NAME = 'deployment.environment.name';

export interface StartTracingOptions {
  /**
   * Logical service name reported on every span.
   * Falls back to `OTEL_SERVICE_NAME` env var, then to `'unknown_service'`.
   */
  readonly serviceName?: string;
}

function parseHeaders(raw: string): Record<string, string> {
  if (!raw) return {};
  return raw
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, pair) => {
      const eq = pair.indexOf('=');
      if (eq <= 0) return acc;
      const key = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (key) acc[key] = value;
      return acc;
    }, {});
}

function bool(value: string | undefined): boolean {
  return value === 'true';
}

/**
 * Bootstraps the OpenTelemetry NodeSDK. Call this **before** any other
 * import so the SDK can patch native modules (`http`, `fs`, `pg`, etc.)
 * before user code resolves them. The SDK is a no-op unless
 * `OTEL_ENABLED=true`.
 */
export function startTracing(options: StartTracingOptions = {}): NodeSDK | null {
  if (!bool(process.env['OTEL_ENABLED'])) return null;

  if (process.env['OTEL_DEBUG'] === 'true') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
  }

  const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318';
  const headers = parseHeaders(process.env['OTEL_EXPORTER_OTLP_HEADERS'] ?? '');
  const ratio = Number.parseFloat(process.env['OTEL_TRACES_SAMPLER_RATIO'] ?? '1');
  const sampler = new TraceIdRatioBasedSampler(Number.isFinite(ratio) ? ratio : 1);

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]:
      options.serviceName ?? process.env['OTEL_SERVICE_NAME'] ?? 'unknown_service',
    [ATTR_SERVICE_NAMESPACE]: process.env['OTEL_SERVICE_NAMESPACE'] ?? 'app',
    [ATTR_SERVICE_VERSION]: process.env['npm_package_version'] ?? '0.0.0',
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env['NODE_ENV'] ?? 'development',
  });

  const sdk = new NodeSDK({
    resource,
    sampler,
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint.replace(/\/$/, '')}/v1/traces`,
      headers,
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${endpoint.replace(/\/$/, '')}/v1/metrics`,
        headers,
      }),
      exportIntervalMillis: 60_000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-pino': { enabled: false },
      }),
    ],
  });

  sdk.start();

  const shutdown = (): void => {
    sdk
      .shutdown()
      .catch((err) => {
        // No DI container at SIGTERM/SIGINT — write directly to stderr.
        process.stderr.write(
          `[otel] shutdown failed: ${err instanceof Error ? err.stack : String(err)}\n`,
        );
      })
      .finally(() => process.exit(0));
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  return sdk;
}
