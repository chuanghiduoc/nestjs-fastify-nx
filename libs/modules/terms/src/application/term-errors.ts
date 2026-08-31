import { DomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS } from '@nestjs-fastify-nx/contracts';

export const termNotFound = () =>
  new DomainException({
    kind: 'not_found',
    code: ERROR_CODES.TERM_NOT_FOUND,
    title: I18N_KEYS.common.not_found,
    messageKey: I18N_KEYS.errors.terms.not_found,
    violations: [
      {
        path: 'id',
        code: ERROR_CODES.TERM_NOT_FOUND,
        message: 'Term not found',
        messageKey: I18N_KEYS.errors.terms.not_found,
      },
    ],
  });

export const termNotPublished = () =>
  new DomainException({
    kind: 'conflict',
    permanent: false,
    code: ERROR_CODES.TERM_NOT_PUBLISHED,
    title: I18N_KEYS.common.conflict,
    messageKey: I18N_KEYS.errors.terms.not_published,
    violations: [
      {
        path: 'id',
        code: ERROR_CODES.TERM_NOT_PUBLISHED,
        message: 'That term version is not published',
        messageKey: I18N_KEYS.errors.terms.not_published,
      },
    ],
  });

export const termVersionTaken = () =>
  new DomainException({
    kind: 'conflict',
    permanent: false,
    code: ERROR_CODES.TERM_VERSION_TAKEN,
    title: I18N_KEYS.common.conflict,
    messageKey: I18N_KEYS.errors.terms.version_taken,
    violations: [
      {
        path: 'version',
        code: ERROR_CODES.TERM_VERSION_TAKEN,
        message: 'This version already exists for this term type',
        messageKey: I18N_KEYS.errors.terms.version_taken,
      },
    ],
  });
