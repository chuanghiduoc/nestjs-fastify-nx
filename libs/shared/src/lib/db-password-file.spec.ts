import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { injectDatabasePassword } from './db-password-file';

describe('injectDatabasePassword', () => {
  let workdir: string;
  let passwordFile: string;
  let emptyFile: string;
  let specialFile: string;
  let percentFile: string;

  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'db-pw-'));
    passwordFile = join(workdir, 'postgres_password');
    emptyFile = join(workdir, 'empty_password');
    specialFile = join(workdir, 'special_password');
    percentFile = join(workdir, 'percent_password');
    writeFileSync(passwordFile, 'super-secret\n');
    writeFileSync(emptyFile, '');
    writeFileSync(specialFile, 'p@ss:wo/rd?#&');
    writeFileSync(percentFile, 'has%25and%enc');
  });

  afterAll(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it('injects password into a postgres URL without a password segment', () => {
    const out = injectDatabasePassword('postgresql://postgres@db:5432/app', passwordFile);
    expect(out).toBe('postgresql://postgres:super-secret@db:5432/app');
  });

  it('also handles the postgres:// (no ql) scheme', () => {
    const out = injectDatabasePassword('postgres://postgres@db:5432/app', passwordFile);
    expect(out).toBe('postgres://postgres:super-secret@db:5432/app');
  });

  it('percent-encodes special characters in the password', () => {
    // Password contains @ : / ? # & — all URL-reserved and encoded via encodeURIComponent.
    const out = injectDatabasePassword('postgresql://app@db:5432/x', specialFile);
    expect(out).toBe('postgresql://app:p%40ss%3Awo%2Frd%3F%23%26@db:5432/x');
  });

  it('round-trips a password containing literal % (would corrupt without encodeURIComponent)', () => {
    // The WHATWG URL setter leaves a bare `%` untouched, producing ambiguous `%XX` that pg mis-decodes.
    // encodeURIComponent escapes `%`→`%25`, so pg-connection-string decodes back to the exact password.
    const out = injectDatabasePassword('postgresql://app@db:5432/x', percentFile);
    expect(out).toBe('postgresql://app:has%2525and%25enc@db:5432/x');
    // Sanity: decoding the userinfo password segment yields the original file content.
    expect(decodeURIComponent('has%2525and%25enc')).toBe('has%25and%enc');
  });

  it('returns the URL unchanged when DB_PASSWORD_FILE is undefined', () => {
    const url = 'postgresql://postgres@db:5432/app';
    expect(injectDatabasePassword(url, undefined)).toBe(url);
  });

  it('returns the URL unchanged when the file does not exist', () => {
    const url = 'postgresql://postgres@db:5432/app';
    expect(injectDatabasePassword(url, join(workdir, 'missing'))).toBe(url);
  });

  it('returns the URL unchanged when the file is empty (after trim)', () => {
    const url = 'postgresql://postgres@db:5432/app';
    expect(injectDatabasePassword(url, emptyFile)).toBe(url);
  });

  it('does not overwrite a URL that already has a user:password pair', () => {
    const url = 'postgresql://postgres:existing@db:5432/app';
    expect(injectDatabasePassword(url, passwordFile)).toBe(url);
  });

  it('returns undefined when the URL is undefined (helper is a no-op on absent envs)', () => {
    expect(injectDatabasePassword(undefined, passwordFile)).toBeUndefined();
  });

  it('returns the URL unchanged for non-postgres schemes', () => {
    const url = 'mysql://root@db:3306/x';
    expect(injectDatabasePassword(url, passwordFile)).toBe(url);
  });

  it('trims trailing newline/whitespace before injecting (Docker-secret convention)', () => {
    // writeFileSync wrote `super-secret\n`; trimmed should not include the LF.
    const out = injectDatabasePassword('postgresql://postgres@db:5432/app', passwordFile);
    expect(out).not.toContain('%0A');
    expect(out).toContain(':super-secret@');
  });
});
