export const SESSION_COOKIE_BASE = 'better-auth.session_token';

/**
 * Whether Better Auth issues secure cookies — and therefore prefixes the session cookie with
 * `__Secure-`. Keyed on the baseURL protocol rather than NODE_ENV alone so an HTTPS staging deploy
 * (NODE_ENV != production) is treated correctly.
 *
 * Exported because more than one place needs the answer: the auth config sets the behaviour, and
 * the Swagger "Authorize" field must name the cookie the browser actually sends. Two independent
 * copies of this condition drift apart silently — the docs would prompt for a cookie name that no
 * longer exists and every "Try it out" would answer 401 while real auth kept working.
 */
export function usesSecureCookies(baseURL?: string): boolean {
  return process.env['NODE_ENV'] === 'production' || (baseURL?.startsWith('https://') ?? false);
}

export function sessionCookieName(baseURL?: string): string {
  return usesSecureCookies(baseURL) ? `__Secure-${SESSION_COOKIE_BASE}` : SESSION_COOKIE_BASE;
}
