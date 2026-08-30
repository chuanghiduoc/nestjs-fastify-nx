import { describe, expect, it } from 'vitest';
import { I18N_KEYS } from './i18n-keys';
import { VALIDATOR_CODES, validatorToCode } from './validation-codes';

describe('validatorToCode', () => {
  it('maps a known class-validator rule to its stable code', () => {
    expect(validatorToCode('isEmail')).toBe('invalid_email');
    expect(validatorToCode('minLength')).toBe('too_short');
    expect(validatorToCode('whitelistValidation')).toBe('unknown_field');
  });

  it('falls back to invalid_value for a rule the table does not carry', () => {
    expect(validatorToCode('isSomeDecoratorAddedLater')).toBe('invalid_value');
  });

  it('never returns a prototype member for a rule named after one', () => {
    expect(validatorToCode('constructor')).toBe('invalid_value');
    expect(validatorToCode('toString')).toBe('invalid_value');
  });
});

describe('VALIDATOR_CODES', () => {
  // Every code doubles as the i18n lookup key, so a value with no matching entry would resolve to
  // undefined at runtime rather than to a translated message.
  it('only maps to codes that exist under I18N_KEYS.validation', () => {
    for (const [rule, code] of Object.entries(VALIDATOR_CODES)) {
      expect(I18N_KEYS.validation[code], `${rule} -> ${code}`).toBeDefined();
    }
  });

  it('covers the fallback code itself', () => {
    expect(I18N_KEYS.validation.invalid_value).toBeDefined();
  });
});
