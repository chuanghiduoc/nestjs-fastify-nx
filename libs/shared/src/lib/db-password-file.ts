import { existsSync, readFileSync } from 'node:fs';

// Injects password from a Docker/k8s secret file into a password-less Postgres URL. Returns untouched if already has password.
export function injectDatabasePassword(
  url: string | undefined,
  passwordFile: string | undefined,
): string | undefined {
  if (!url || !passwordFile) return url;
  if (!existsSync(passwordFile)) return url;

  const match = url.match(/^(postgres(?:ql)?:\/\/)([^@:/]+)@(.+)$/);
  if (!match) return url;

  const password = readFileSync(passwordFile, 'utf8').trim();
  if (!password) return url;

  return `${match[1]}${match[2]}:${encodeURIComponent(password)}@${match[3]}`;
}
