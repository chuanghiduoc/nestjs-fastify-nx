import { createHash, randomBytes } from 'node:crypto';

export const API_KEY_PREFIX = 'sk_';
export const API_KEY_SECRET_BYTES = 32;
export const API_KEY_DISPLAY_PREFIX_LENGTH = API_KEY_PREFIX.length + 8;

export interface GeneratedApiKey {
  /** Shown to the caller exactly once; never persisted. */
  readonly raw: string;
  /** Non-secret fragment persisted so an operator can tell two keys apart. */
  readonly prefix: string;
  readonly hash: string;
}

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function apiKeyDisplayPrefix(raw: string): string {
  return raw.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH);
}

export function generateApiKey(): GeneratedApiKey {
  const raw = `${API_KEY_PREFIX}${randomBytes(API_KEY_SECRET_BYTES).toString('base64url')}`;
  return { raw, prefix: apiKeyDisplayPrefix(raw), hash: hashApiKey(raw) };
}

export function looksLikeApiKey(candidate: string): boolean {
  return candidate.startsWith(API_KEY_PREFIX) && candidate.length > API_KEY_DISPLAY_PREFIX_LENGTH;
}
