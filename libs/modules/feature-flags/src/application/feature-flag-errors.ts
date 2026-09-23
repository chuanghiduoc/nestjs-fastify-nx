import { DomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS, fieldProblem } from '@nestjs-fastify-nx/contracts';

export const featureFlagNotFound = () =>
  new DomainException(
    fieldProblem({
      kind: 'not_found',
      code: ERROR_CODES.FEATURE_FLAG_NOT_FOUND,
      messageKey: I18N_KEYS.errors.feature_flags.not_found,
      path: 'id',
      message: 'Feature flag not found',
    }),
  );

export const featureFlagKeyTaken = () =>
  new DomainException(
    fieldProblem({
      kind: 'conflict',
      permanent: false,
      code: ERROR_CODES.FEATURE_FLAG_KEY_TAKEN,
      messageKey: I18N_KEYS.errors.feature_flags.key_taken,
      path: 'key',
      message: 'A feature flag with this key already exists in the organization',
    }),
  );
