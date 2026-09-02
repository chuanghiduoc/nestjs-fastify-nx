// Shared by main.ts and the e2e harness. Keeping the exclude list in one place is what stops a
// route from being reachable in production and 404 in tests, or the reverse.
export const GLOBAL_PREFIX = 'api';

// `metrics` is scraped by Prometheus at a fixed path; `errors/*` is where the RFC 9457 `type` URIs
// in error bodies already point. Both would break if the prefix were applied.
export const GRAPHQL_PATH = '/graphql';

const GRAPHQL_ROUTE = GRAPHQL_PATH.slice(1);

export const GLOBAL_PREFIX_EXCLUDES = ['metrics', 'errors', 'errors/:slug', GRAPHQL_ROUTE] as const;
