import { DomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS, fieldProblem } from '@nestjs-fastify-nx/contracts';

export const termNotFound = () =>
  new DomainException(
    fieldProblem({
      kind: 'not_found',
      code: ERROR_CODES.TERM_NOT_FOUND,
      messageKey: I18N_KEYS.errors.terms.not_found,
      path: 'id',
      message: 'Term not found',
    }),
  );

export const termNotPublished = () =>
  new DomainException(
    fieldProblem({
      kind: 'conflict',
      permanent: false,
      code: ERROR_CODES.TERM_NOT_PUBLISHED,
      messageKey: I18N_KEYS.errors.terms.not_published,
      path: 'id',
      message: 'That term version is not published',
    }),
  );

export const termVersionTaken = () =>
  new DomainException(
    fieldProblem({
      kind: 'conflict',
      permanent: false,
      code: ERROR_CODES.TERM_VERSION_TAKEN,
      messageKey: I18N_KEYS.errors.terms.version_taken,
      path: 'version',
      message: 'This version already exists for this term type',
    }),
  );
