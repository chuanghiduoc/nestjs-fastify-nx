import { existsSync, readFileSync } from 'node:fs';

// Injects a password from a Docker/k8s secret file into a password-less Postgres URL. Returns the URL
// untouched if it already carries a password, has no username, is not a postgres URL, or is unparseable.
export function injectDatabasePassword(
  url: string | undefined,
  passwordFile: string | undefined,
): string | undefined {
  if (!url || !passwordFile) return url;
  if (!existsSync(passwordFile)) return url;

  let parsed: URL;
  try {
    // WHATWG URL parses userinfo, IPv6 hosts, and query strings correctly where a hand-rolled regex
    // would mis-split them. Limitation: it rejects comma-separated multi-host DSNs (rare HA form);
    // those fall through unchanged and would surface as a loud auth error at connect time.
    parsed = new URL(url);
  } catch {
    return url;
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') return url;
  if (parsed.password !== '' || parsed.username === '') return url;

  const password = readFileSync(passwordFile, 'utf8').trim();
  if (!password) return url;

  // encodeURIComponent, NOT the raw value: the WHATWG URL password setter does not percent-encode a
  // literal `%`, so a password containing `%` would serialize to an ambiguous `%XX` that libpq /
  // pg-connection-string mis-decode → wrong password → DB auth failure. Escaping every reserved char
  // here makes the DSN round-trip back to the exact password.
  parsed.password = encodeURIComponent(password);
  return parsed.toString();
}
