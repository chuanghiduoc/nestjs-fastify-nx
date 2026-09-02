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

// Root level (`{ password }`) plus one and two levels deep. A pino/fast-redact `*` matches exactly
// one level and does NOT cover the root, so the bare key is listed too — otherwise a raw
// `logger.info({ password })` would leak the secret.
const WILDCARD_PATHS = SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]);

export const SENSITIVE_REDACT_PATHS = [...REQUEST_RESPONSE_PATHS, ...WILDCARD_PATHS];

export const SENSITIVE_REDACT_CENSOR = '[REDACTED]';

/** Keep only the request path so query tokens, emails and search terms never enter telemetry. */
export function sanitizeUrlForLogging(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const query = value.indexOf('?');
  const fragment = value.indexOf('#');
  const cutAt = query === -1 ? fragment : fragment === -1 ? query : Math.min(query, fragment);
  return cutAt === -1 ? value : value.slice(0, cutAt);
}

export interface SafeSerializedError {
  type: string;
  code?: string;
}

function safeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string' && typeof code !== 'number') return undefined;
  const rendered = String(code);
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(rendered) ? rendered : undefined;
}

/**
 * Messages and stacks can contain DSNs, SQL values, tokens and response bodies. Record only the
 * class and a constrained machine code; call sites add safe operational context separately.
 */
export function serializeErrorSafely(error: unknown): SafeSerializedError {
  const candidateName =
    error && typeof error === 'object' ? (error as { name?: unknown }).name : undefined;
  const type =
    error instanceof Error
      ? error.name || 'Error'
      : typeof candidateName === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(candidateName)
        ? candidateName
        : 'Error';
  const code = safeErrorCode(error);
  return code ? { type, code } : { type };
}

export function safeErrorSummary(error: unknown): string {
  const safe = serializeErrorSafely(error);
  return safe.code ? `${safe.type} (${safe.code})` : safe.type;
}

const SENSITIVE_TEXT_KEYS =
  'access_token|refresh_token|session_token|token|secret|password|api[-_]?key';
const JSON_SENSITIVE_MEMBER = new RegExp(
  `("(?:${SENSITIVE_TEXT_KEYS})"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`,
  'gi',
);
const BARE_SENSITIVE_ASSIGNMENT = new RegExp(
  `\\b(?:${SENSITIVE_TEXT_KEYS})\\s*[:=]\\s*[^\\s,;]+`,
  'gi',
);

function redactAfterFirstSeparator(match: string): string {
  const separatorAt = match.search(/[:=]/);
  return `${match.slice(0, separatorAt + 1)}[REDACTED]`;
}

/** Defense in depth for third-party telemetry SDKs that accept only rendered strings. */
export function sanitizeSensitiveText(value: string): string {
  return value
    .replace(/:\/\/([^:/\s]+):([^@\s]+)@/g, '://$1:[REDACTED]@')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /([?&](?:access_token|refresh_token|session_token|token|code|secret|password|api[-_]?key|email)=)[^&#\s]*/gi,
      '$1[REDACTED]',
    )
    .replace(JSON_SENSITIVE_MEMBER, '$1"[REDACTED]"')
    .replace(BARE_SENSITIVE_ASSIGNMENT, redactAfterFirstSeparator)
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]');
}
