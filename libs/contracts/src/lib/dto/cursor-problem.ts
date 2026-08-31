import { ERROR_CODES } from '../errors/error-codes';
import { I18N_KEYS } from '../i18n-keys';

/**
 * Payload for the `DomainException` a handler raises when `startingAfter` fails to decode. It lives
 * here rather than in core because the copy and the error code are contract surface, and core may
 * not depend on contracts. Handlers construct the exception themselves:
 * `throw new DomainException(invalidCursorProblem())`.
 */
export function invalidCursorProblem(path = 'startingAfter') {
  return {
    kind: 'malformed' as const,
    title: I18N_KEYS.common.bad_request,
    code: ERROR_CODES.INVALID_CURSOR,
    messageKey: I18N_KEYS.errors.pagination.invalid_cursor,
    violations: [
      {
        path,
        code: ERROR_CODES.INVALID_CURSOR,
        message: `${path} is not a valid cursor`,
        messageKey: I18N_KEYS.errors.pagination.invalid_cursor,
      },
    ],
  };
}
