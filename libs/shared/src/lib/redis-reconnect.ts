const RECONNECT_STEP_MS = 200;
const RECONNECT_CAP_MS = 3000;

// ioredis treats any non-number returned from `retryStrategy` as "stop reconnecting for good".
// That turns a transient Redis blip into a permanent failure — the client never heals and the
// feature behind it (queue, rate limit, idempotency, health probe, metrics leadership, WS pub/sub)
// stays broken until the process restarts. Always return a capped backoff delay instead; per-command
// timeouts (`maxRetriesPerRequest`, `enableOfflineQueue: false`) are what bound how long a call waits
// during the outage, not this.
export function redisReconnectStrategy(times: number): number {
  return Math.min(times * RECONNECT_STEP_MS, RECONNECT_CAP_MS);
}
