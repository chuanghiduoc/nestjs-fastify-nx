import { I18N_KEYS } from './i18n-keys';

// class-validator decorator name → stable i18n key.
// Keep in sync with VALIDATOR_TO_CODE in `validation.pipe.ts` — both maps document the same translation contract.
export const VALIDATION_CONSTRAINT_KEYS: Record<string, string> = {
  isDefined: I18N_KEYS.validation.required,
  isNotEmpty: I18N_KEYS.validation.required,
  isOptional: I18N_KEYS.validation.required,

  isString: I18N_KEYS.validation.wrong_type,
  isNumber: I18N_KEYS.validation.wrong_type,
  isInt: I18N_KEYS.validation.wrong_type,
  isBoolean: I18N_KEYS.validation.wrong_type,
  isArray: I18N_KEYS.validation.wrong_type,
  isObject: I18N_KEYS.validation.wrong_type,
  isDate: I18N_KEYS.validation.wrong_type,
  isEnum: I18N_KEYS.validation.invalid_enum_value,

  isEmail: I18N_KEYS.validation.invalid_email,
  isUrl: I18N_KEYS.validation.invalid_url,
  isUuid: I18N_KEYS.validation.invalid_uuid,
  isPhoneNumber: I18N_KEYS.validation.invalid_phone,
  isMobilePhone: I18N_KEYS.validation.invalid_phone,
  matches: I18N_KEYS.validation.pattern_mismatch,
  isAlpha: I18N_KEYS.validation.pattern_mismatch,
  isAlphanumeric: I18N_KEYS.validation.pattern_mismatch,
  isAscii: I18N_KEYS.validation.pattern_mismatch,
  isCreditCard: I18N_KEYS.validation.invalid_credit_card,
  isHexColor: I18N_KEYS.validation.pattern_mismatch,
  isJWT: I18N_KEYS.validation.pattern_mismatch,

  min: I18N_KEYS.validation.out_of_range,
  max: I18N_KEYS.validation.out_of_range,
  isPositive: I18N_KEYS.validation.out_of_range,
  isNegative: I18N_KEYS.validation.out_of_range,
  minDate: I18N_KEYS.validation.out_of_range,
  maxDate: I18N_KEYS.validation.out_of_range,

  minLength: I18N_KEYS.validation.too_short,
  maxLength: I18N_KEYS.validation.too_long,
  length: I18N_KEYS.validation.wrong_length,
  arrayMinSize: I18N_KEYS.validation.too_short,
  arrayMaxSize: I18N_KEYS.validation.too_long,

  isIn: I18N_KEYS.validation.invalid_enum_value,
  isNotIn: I18N_KEYS.validation.forbidden_value,

  whitelistValidation: I18N_KEYS.validation.unknown_field,
};

export function mapConstraintToI18nKey(constraint: string): string {
  return VALIDATION_CONSTRAINT_KEYS[constraint] ?? I18N_KEYS.validation.invalid_value;
}
