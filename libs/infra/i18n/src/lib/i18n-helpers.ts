import type { I18nService } from 'nestjs-i18n';

// Falls back to the literal key when translation lookup fails — keeps error responses informative when a JSON file is missing a row.
export async function translateOrFallback(
  i18n: I18nService,
  key: string,
  options?: { lang?: string; args?: Record<string, unknown> },
): Promise<string> {
  try {
    const translated = await i18n.translate(key, {
      lang: options?.lang,
      args: options?.args,
    });
    if (typeof translated === 'string' && translated !== key) return translated;
    return typeof translated === 'string' ? translated : key;
  } catch {
    return key;
  }
}

// Accepts the common request shapes used in this codebase: FastifyRequest (Node IncomingMessage-style headers), Fetch API Request (Headers instance), or a header bag passed directly. Better Auth callbacks supply a Fetch Request; controllers receive a FastifyRequest.
type LocaleSource =
  | { headers?: unknown; query?: unknown }
  | { headers: { get(name: string): string | null } }
  | Record<string, unknown>
  | undefined;

// Resolver order mirrors I18nInfraModule.forRoot: ?lang= → x-lang header → Accept-Language.
export function resolveRequestLocale(source: LocaleSource, fallback = 'en'): string {
  if (!source) return fallback;

  const query = readQuery(source);
  const queryLang = typeof query?.['lang'] === 'string' ? query['lang'] : undefined;
  if (queryLang) return normalize(queryLang);

  const xLang = readHeader(source, 'x-lang');
  if (xLang) return normalize(xLang);

  const acceptLanguage = readHeader(source, 'accept-language');
  if (acceptLanguage) {
    const primary = acceptLanguage.split(',')[0]?.split(';')[0]?.trim();
    if (primary) return normalize(primary);
  }

  return fallback;
}

function readQuery(source: LocaleSource): Record<string, unknown> | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const q = (source as { query?: unknown }).query;
  return q && typeof q === 'object' ? (q as Record<string, unknown>) : undefined;
}

function readHeader(source: LocaleSource, name: string): string | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const headers = (source as { headers?: unknown }).headers;
  if (!headers) return undefined;

  // Fetch API Headers instance.
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const value = (headers as { get(n: string): string | null }).get(name);
    return value ?? undefined;
  }

  const bag = headers as Record<string, string | string[] | undefined>;
  const value = bag[name] ?? bag[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return typeof value === 'string' ? value : undefined;
}

// Collapse 'vi-VN' → 'vi' so a single JSON namespace covers a language family.
function normalize(lang: string): string {
  return lang.toLowerCase().split('-')[0] ?? lang;
}
