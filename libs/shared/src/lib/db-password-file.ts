import { existsSync, readFileSync } from 'node:fs';

/**
 * Inject the DB password from a mounted secret file into a Postgres URL.
 *
 * Production deployments that ship the DB password via Docker secrets, Kubernetes
 * secrets, or HashiCorp Vault Agent set `DB_PASSWORD_FILE=/path/to/secret` and
 * publish a `DATABASE_URL=postgresql://user@host/db` without the password so
 * the secret is never inlined into env vars (visible via `docker inspect`, k8s
 * `describe pod`, or process listings).
 *
 * This helper reads the file once and rewrites `postgresql://user@host/db`
 * into `postgresql://user:password@host/db`. URLs that already carry a password
 * are returned untouched, so adding `DB_PASSWORD_FILE` to a dev setup that
 * still has the password inline is a safe no-op.
 *
 * Returns the URL unchanged when:
 *   - `url` is undefined / empty
 *   - `passwordFile` is undefined / empty
 *   - the file path does not exist
 *   - the URL is not a `postgres(ql)?://user@host` shape (already has a
 *     password, uses a non-Postgres scheme, malformed, etc.)
 *   - the file content is empty after trim
 */
export function injectDatabasePassword(
  url: string | undefined,
  passwordFile: string | undefined,
): string | undefined {
  if (!url || !passwordFile) return url;
  if (!existsSync(passwordFile)) return url;

  // Match `postgres(ql)?://<user-or-userinfo>@<rest>`. The user-or-userinfo
  // segment forbids `:` to avoid clobbering an existing `user:pass` pair.
  const match = url.match(/^(postgres(?:ql)?:\/\/)([^@:/]+)@(.+)$/);
  if (!match) return url;

  const password = readFileSync(passwordFile, 'utf8').trim();
  if (!password) return url;

  // Percent-encode the password so passwords containing reserved URL chars
  // (`@`, `:`, `/`, `?`, `#`, space) do not break the connection string.
  return `${match[1]}${match[2]}:${encodeURIComponent(password)}@${match[3]}`;
}
