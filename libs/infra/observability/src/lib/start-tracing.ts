import {
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  type Context,
  type TextMapPropagator,
} from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

// Incubating OTel attr — inlined to avoid pulling in a package that requires moduleResolution: nodenext.
const ATTR_DEPLOYMENT_ENVIRONMENT_NAME = 'deployment.environment.name';

export interface StartTracingOptions {
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

// Public-edge default: keep injecting our trace context into downstream calls, but IGNORE any
// inbound traceparent/baggage so external callers cannot inject or collide trace ids, force the
// sampling decision, or smuggle baggage into our pipeline. Flip OTEL_TRUST_INBOUND_TRACEPARENT=true
// only when the service sits behind a trusted mesh/gateway that owns the root span.
function injectOnly(delegate: TextMapPropagator): TextMapPropagator {
  return {
    inject: (ctx, carrier, setter) => delegate.inject(ctx, carrier, setter),
    extract: (ctx: Context) => ctx,
    fields: () => delegate.fields(),
  };
}

// Call before any other import so the SDK patches native modules (http, pg, etc.) first.
export function startTracing(options: StartTracingOptions = {}): NodeSDK | null {
  if (!bool(process.env['OTEL_ENABLED'])) return null;

  if (process.env['OTEL_DEBUG'] === 'true') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
  }

  const endpoint = (process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318').replace(
    /\/$/,
    '',
  );
  const headers = parseHeaders(process.env['OTEL_EXPORTER_OTLP_HEADERS'] ?? '');
  const ratio = Number.parseFloat(process.env['OTEL_TRACES_SAMPLER_RATIO'] ?? '1');

  // ParentBased, not a bare ratio sampler: the root sampler only decides for a NEW trace; a child
  // span MUST honor the parent's sampled flag, otherwise cross-service traces come back with holes
  // (a downstream service dropping spans its parent kept). Client-forced sampling is still blocked
  // because injectOnly() strips the inbound parent on the public edge — see textMapPropagator below.
  const sampler = new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(Number.isFinite(ratio) ? ratio : 1),
  });

  const basePropagator = new CompositePropagator({
    propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
  });
  const textMapPropagator = bool(process.env['OTEL_TRUST_INBOUND_TRACEPARENT'])
    ? basePropagator
    : injectOnly(basePropagator);

  // Prometheus (prom-client pull, /metrics) is the metrics source of truth for the API. This OTLP
  // push reader is opt-in — enable it only where there is no prom-client scrape endpoint (worker,
  // scheduler) so those processes still export runtime metrics. Leaving it on in the API would
  // double-count the same series across two pipelines.
  const metricsExportEnabled = bool(process.env['OTEL_METRICS_EXPORT_ENABLED']);

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
    textMapPropagator,
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
      headers,
    }),
    metricReader: metricsExportEnabled
      ? new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            url: `${endpoint}/v1/metrics`,
            headers,
          }),
          exportIntervalMillis: 60_000,
        })
      : undefined,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        // Pino instrumentation injects trace_id/span_id into every log line so
        // logs can be pivoted to their trace in the backend.
        '@opentelemetry/instrumentation-pino': { enabled: true },
      }),
    ],
  });

  sdk.start();

  const shutdown = (): void => {
    sdk.shutdown().catch((err) => {
      process.stderr.write(
        `[otel] shutdown failed: ${err instanceof Error ? err.stack : String(err)}\n`,
      );
    });
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  return sdk;
}
