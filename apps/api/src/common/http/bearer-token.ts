// Length of the `bearer ` scheme prefix, including its single trailing space.
const SCHEME_LENGTH = 'bearer '.length;
const SCHEME = 'bearer ';

/**
 * Extracts the credential from an `Authorization: Bearer <token>` header, mirroring Better Auth's
 * bearer plugin **exactly**:
 *
 * ```js
 * if (authHeader.slice(0, 7).toLowerCase() !== 'bearer ') return;
 * const token = authHeader.slice(7).trim();
 * ```
 *
 * The scheme is case-insensitive per RFC 9110 §11.1, so `bearer`, `BEARER` and `Bearer` all
 * authenticate. Any caller that parses the header itself MUST agree with that, or it disagrees with
 * the plugin about who the caller is: the idempotency plugin would silently drop a lowercase-scheme
 * request to IP scope (letting two clients behind one NAT share a keyspace), and the WebSocket
 * middleware would reject a socket Better Auth would have accepted.
 *
 * Deliberately not a `/^Bearer\s+(.+)$/i` regex: `\s+` also matches a tab, which Better Auth's
 * fixed 7-character slice does not, so a regex would accept credentials the plugin rejects and put
 * the two parsers back out of step.
 */
export function extractBearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string' || value.slice(0, SCHEME_LENGTH).toLowerCase() !== SCHEME) {
    return undefined;
  }
  return value.slice(SCHEME_LENGTH).trim() || undefined;
}
