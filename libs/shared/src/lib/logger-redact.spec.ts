import { describe, expect, it } from 'vitest';
import {
  safeErrorSummary,
  sanitizeSensitiveText,
  sanitizeUrlForLogging,
  serializeErrorSafely,
} from './logger-redact';

describe('logging sanitizers', () => {
  it('removes query strings and fragments from request targets', () => {
    expect(sanitizeUrlForLogging('/verify?token=top-secret&email=a@example.com')).toBe('/verify');
    expect(sanitizeUrlForLogging('https://example.test/reset?token=secret#step')).toBe(
      'https://example.test/reset',
    );
    expect(sanitizeUrlForLogging('/users#details')).toBe('/users');
    expect(sanitizeUrlForLogging(undefined)).toBeUndefined();
  });

  it('keeps only the error type and a constrained machine code', () => {
    const error = Object.assign(
      new Error('connect postgresql://admin:secret@db/app?token=top-secret'),
      { code: 'P2024' },
    );

    expect(serializeErrorSafely(error)).toEqual({ type: 'Error', code: 'P2024' });
    expect(safeErrorSummary(error)).toBe('Error (P2024)');
    expect(JSON.stringify(serializeErrorSafely(error))).not.toContain('secret');
  });

  it('drops unsafe error codes instead of reflecting arbitrary text', () => {
    expect(serializeErrorSafely({ name: 'DriverError', code: 'token=top-secret' })).toEqual({
      type: 'DriverError',
    });
  });

  it('scrubs credentials from strings passed to third-party telemetry', () => {
    const rendered = sanitizeSensitiveText(
      'postgresql://admin:db-pass@db/app Bearer abc.def token=reset-secret email=a@example.com',
    );
    expect(rendered).not.toContain('db-pass');
    expect(rendered).not.toContain('abc.def');
    expect(rendered).not.toContain('reset-secret');
    expect(rendered).not.toContain('a@example.com');
  });

  it('redacts JSON-shaped secrets regardless of key casing and whitespace', () => {
    const rendered = sanitizeSensitiveText(
      '{"Password" : "hunter2", "token":"abc\\"def", "apiKey": "k1", "name": "x:y"}',
    );
    expect(rendered).not.toContain('hunter2');
    expect(rendered).not.toContain('abc');
    expect(rendered).not.toContain('k1');
    expect(rendered).toContain('"Password" : "[REDACTED]"');
    expect(rendered).toContain('"name": "x:y"');
  });

  it('redacts everything after the first separator when the value itself contains one', () => {
    expect(sanitizeSensitiveText('password=abc:def secret: x=y')).toBe(
      'password=[REDACTED] secret:[REDACTED]',
    );
    expect(sanitizeSensitiveText('token:a=b=c')).toBe('token:[REDACTED]');
  });
});
