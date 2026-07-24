// Explicit request/response paths are a safety net for any place a RAW req/res object is logged
// manually (e.g. `logger.error({ req }, ...)`). Note: pino's HTTP access log uses a custom `req`
// serializer that reduces req to { method, url, remoteAddress } BEFORE redaction runs, so these
// header/body paths never match there — the access log simply never carries them.
const REQUEST_RESPONSE_PATHS = [
  'req.headers.authorization',
  'req.headers["authorization"]',
  'req.headers.cookie',
  'req.headers["cookie"]',
  'req.headers["x-api-key"]',
  'req.headers["x-auth-token"]',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.newPassword',
  'req.body.currentPassword',
  'req.body.token',
  'req.body.refreshToken',
  'req.body.accessToken',
];

// Sensitive property names redacted wherever they appear inside a logged object. A pino/fast-redact
// `*` matches exactly one level, so each key is listed at one AND two levels deep to also cover
// objects logged a level lower (e.g. { user: { profile: { password } } }). sessionToken is distinct
// from token — Better Auth attaches `sessionToken` to req.user, which `*.token` would not match.
const SENSITIVE_KEYS = [
  'password',
  'passwordHash',
  'token',
  'sessionToken',
  'refreshToken',
  'accessToken',
  'apiKey',
  'secret',
];

const WILDCARD_PATHS = SENSITIVE_KEYS.flatMap((key) => [`*.${key}`, `*.*.${key}`]);

export const SENSITIVE_REDACT_PATHS = [...REQUEST_RESPONSE_PATHS, ...WILDCARD_PATHS];

export const SENSITIVE_REDACT_CENSOR = '[REDACTED]';
