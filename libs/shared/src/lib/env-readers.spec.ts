import { afterEach, describe, expect, it } from 'vitest';
import { boolEnv, intEnv, positiveIntEnv } from './env-readers';

describe('environment readers', () => {
  afterEach(() => {
    delete process.env['TEST_ENV_READER'];
  });

  it('accepts complete integer strings including zero and surrounding whitespace', () => {
    process.env['TEST_ENV_READER'] = ' 0 ';
    expect(intEnv('TEST_ENV_READER', 7)).toBe(0);
  });

  it('rejects partially numeric and unsafe integer values', () => {
    process.env['TEST_ENV_READER'] = '12ms';
    expect(intEnv('TEST_ENV_READER', 7)).toBe(7);
    process.env['TEST_ENV_READER'] = '9007199254740992';
    expect(intEnv('TEST_ENV_READER', 7)).toBe(7);
  });

  it('requires positive values in positiveIntEnv', () => {
    process.env['TEST_ENV_READER'] = '0';
    expect(positiveIntEnv('TEST_ENV_READER', 5)).toBe(5);
  });

  it('parses booleans without treating arbitrary strings as true', () => {
    process.env['TEST_ENV_READER'] = 'true';
    expect(boolEnv('TEST_ENV_READER', false)).toBe(true);
    process.env['TEST_ENV_READER'] = '1';
    expect(boolEnv('TEST_ENV_READER', false)).toBe(false);
  });
});
