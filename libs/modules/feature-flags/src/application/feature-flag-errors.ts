import { DomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS } from '@nestjs-fastify-nx/contracts';

export const featureFlagNotFound = () =>
  new DomainException({
    kind: 'not_found',
    code: ERROR_CODES.FEATURE_FLAG_NOT_FOUND,
    title: I18N_KEYS.common.not_found,
    messageKey: I18N_KEYS.errors.feature_flags.not_found,
    violations: [
      {
        path: 'id',
        code: ERROR_CODES.FEATURE_FLAG_NOT_FOUND,
        message: 'Feature flag not found',
        messageKey: I18N_KEYS.errors.feature_flags.not_found,
      },
    ],
  });

export const featureFlagKeyTaken = () =>
  new DomainException({
    kind: 'conflict',
    permanent: false,
    code: ERROR_CODES.FEATURE_FLAG_KEY_TAKEN,
    title: I18N_KEYS.common.conflict,
    messageKey: I18N_KEYS.errors.feature_flags.key_taken,
    violations: [
      {
        path: 'key',
        code: ERROR_CODES.FEATURE_FLAG_KEY_TAKEN,
        message: 'A feature flag with this key already exists in the organization',
        messageKey: I18N_KEYS.errors.feature_flags.key_taken,
      },
    ],
  });
