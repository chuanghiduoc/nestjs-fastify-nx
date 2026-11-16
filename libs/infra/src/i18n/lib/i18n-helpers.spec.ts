import { describe, expect, it } from 'vitest';
import type { I18nService } from 'nestjs-i18n';
import { resolveRequestLocale, translateOrFallback } from './i18n-helpers';

function service(translate: (key: string, options: unknown) => Promise<unknown>): I18nService {
  return { translate } as unknown as I18nService;
}

describe('translateOrFallback', () => {
  it('returns the translated string', async () => {
    const i18n = service(async () => 'translated');

    await expect(translateOrFallback(i18n, 'errors.not_found')).resolves.toBe('translated');
  });

  it('falls back to the key when translation throws', async () => {
    const i18n = service(async () => {
      throw new Error('missing catalog');
    });

    await expect(translateOrFallback(i18n, 'errors.not_found')).resolves.toBe('errors.not_found');
  });

  it('falls back to the key when the catalog returns a non-string', async () => {
    const i18n = service(async () => ({ nested: true }));

    await expect(translateOrFallback(i18n, 'errors.not_found')).resolves.toBe('errors.not_found');
  });
});

describe('resolveRequestLocale', () => {
  it('prefers ?lang= from a controller query', () => {
    expect(resolveRequestLocale({ query: { lang: 'vi-VN' }, headers: {} })).toBe('vi');
  });

  it('parses ?lang= from a Fetch API Request URL', () => {
    expect(resolveRequestLocale({ url: 'https://api.example.com/reset?lang=de-DE' })).toBe('de');
  });

  it('reads x-lang before Accept-Language', () => {
    expect(
      resolveRequestLocale({
        headers: { 'x-lang': 'fr', 'accept-language': 'vi-VN,vi;q=0.9' },
      }),
    ).toBe('fr');
  });

  it('uses the primary Accept-Language tag and normalizes the region', () => {
    expect(
      resolveRequestLocale({
        headers: { 'accept-language': 'vi-VN,vi;q=0.9,en;q=0.8' },
      }),
    ).toBe('vi');
  });

  it('supports a Fetch Headers instance', () => {
    const headers = new Headers({ 'x-lang': 'es-MX' });

    expect(resolveRequestLocale({ headers })).toBe('es');
  });

  it('falls back when no source provides a locale', () => {
    expect(resolveRequestLocale(undefined)).toBe('en');
    expect(resolveRequestLocale({ headers: {} }, 'vi')).toBe('vi');
    expect(resolveRequestLocale({ url: 'not a url' })).toBe('en');
  });
});
