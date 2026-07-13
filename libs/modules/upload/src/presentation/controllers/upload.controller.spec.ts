import { describe, expect, it } from 'vitest';
import { verificationJobId } from './upload.controller';

describe('verificationJobId', () => {
  it('is stable for retries and collision-resistant for delimiter variants', () => {
    expect(verificationJobId('users/a/b_c')).toBe(verificationJobId('users/a/b_c'));
    expect(verificationJobId('users/a/b_c')).not.toBe(verificationJobId('users/a_b/c'));
    expect(verificationJobId('users/a/b_c')).toMatch(/^verify__[a-f0-9]{64}$/);
  });
});
