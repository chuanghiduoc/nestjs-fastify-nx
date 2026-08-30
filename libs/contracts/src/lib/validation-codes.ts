import type { I18N_KEYS } from './i18n-keys';

export const VALIDATOR_CODES: Readonly<Record<string, keyof typeof I18N_KEYS.validation>> = {
  isDefined: 'required',
  isNotEmpty: 'required',
  isOptional: 'required',

  isString: 'wrong_type',
  isNumber: 'wrong_type',
  isInt: 'wrong_type',
  isBoolean: 'wrong_type',
  isArray: 'wrong_type',
  isObject: 'wrong_type',
  isDate: 'wrong_type',
  isEnum: 'invalid_enum_value',

  isEmail: 'invalid_email',
  isUrl: 'invalid_url',
  isUuid: 'invalid_uuid',
  isPhoneNumber: 'invalid_phone',
  isMobilePhone: 'invalid_phone',
  matches: 'pattern_mismatch',
  isAlpha: 'pattern_mismatch',
  isAlphanumeric: 'pattern_mismatch',
  isAscii: 'pattern_mismatch',
  isCreditCard: 'invalid_credit_card',
  isHexColor: 'pattern_mismatch',
  isJWT: 'pattern_mismatch',

  min: 'out_of_range',
  max: 'out_of_range',
  isPositive: 'out_of_range',
  isNegative: 'out_of_range',
  minDate: 'out_of_range',
  maxDate: 'out_of_range',

  minLength: 'too_short',
  maxLength: 'too_long',
  length: 'wrong_length',
  arrayMinSize: 'too_short',
  arrayMaxSize: 'too_long',

  isIn: 'invalid_enum_value',
  isNotIn: 'forbidden_value',

  whitelistValidation: 'unknown_field',
};

export function validatorToCode(rule: string): keyof typeof I18N_KEYS.validation {
  return VALIDATOR_CODES[rule] ?? 'invalid_value';
}
