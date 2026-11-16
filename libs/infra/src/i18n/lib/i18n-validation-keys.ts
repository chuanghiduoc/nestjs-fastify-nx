import { I18N_KEYS, VALIDATOR_CODES, validatorToCode } from '@nestjs-fastify-nx/contracts';

export const VALIDATION_CONSTRAINT_KEYS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(VALIDATOR_CODES).map(([rule, code]) => [rule, I18N_KEYS.validation[code]]),
);

export function mapConstraintToI18nKey(constraint: string): string {
  return I18N_KEYS.validation[validatorToCode(constraint)];
}
