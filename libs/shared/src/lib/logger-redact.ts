/**
 * Pino redaction policy shared by every long-running process (api, worker,
 * scheduler). The api is the most exposed surface — it terminates HTTP and
 * therefore handles Better Auth's session cookies — but worker / scheduler
 * also see job payloads that may carry secrets, so we apply the same policy
 * everywhere rather than picking and choosing per process.
 *
 * Better Auth ships its session as `better-auth.session_token` +
 * `better-auth.session_data` HttpOnly cookies; logging the raw `cookie` or
 * `set-cookie` headers would leak a valid bearer credential into log
 * aggregators. The body fields cover the password setup, password change,
 * and refresh-token paths.
 */
export const SENSITIVE_REDACT_PATHS = [
  // Authentication credentials in transit.
  'req.headers.authorization',
  'req.headers["authorization"]',
  'req.headers.cookie',
  'req.headers["cookie"]',
  'req.headers["x-api-key"]',
  'req.headers["x-auth-token"]',
  'res.headers["set-cookie"]',
  // Common credential / token field names.
  'req.body.password',
  'req.body.newPassword',
  'req.body.currentPassword',
  'req.body.token',
  'req.body.refreshToken',
  'req.body.accessToken',
  // BullMQ jobs sometimes carry these directly when domain events get
  // serialised into queue payloads.
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.apiKey',
  '*.secret',
];

export const SENSITIVE_REDACT_CENSOR = '[REDACTED]';
