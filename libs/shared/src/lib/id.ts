import { randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';

// Time-ordered UUIDv7 for database rows — sequential inserts keep B-tree indexes compact.
export function generateId(): string {
  return uuidv7();
}

// 128-bit random hex matching the W3C trace-id shape. Correlation-id fallback when tracing
// is off, so X-Request-Id has one uniform format whether or not a trace is active.
export function generateCorrelationId(): string {
  return randomBytes(16).toString('hex');
}
