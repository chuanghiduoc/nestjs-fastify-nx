export const SENSITIVE_REDACT_PATHS = [
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
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.apiKey',
  '*.secret',
];

export const SENSITIVE_REDACT_CENSOR = '[REDACTED]';
