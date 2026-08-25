import proxyaddr from 'proxy-addr';

export function parseTrustedProxies(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function isCompilableTrustedProxyList(values: readonly string[]): boolean {
  if (values.length === 0) return true;
  try {
    proxyaddr.compile([...values]);
    return true;
  } catch {
    return false;
  }
}

export function resolveTrustedProxies(raw: string | undefined): string[] {
  const values = parseTrustedProxies(raw);
  return isCompilableTrustedProxyList(values) ? values : [];
}
