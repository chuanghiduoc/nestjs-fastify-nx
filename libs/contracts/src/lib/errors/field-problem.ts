import { I18N_KEYS } from '../i18n-keys';

type FieldProblemKind = 'malformed' | 'validation' | 'conflict' | 'not_found' | 'forbidden';

const TITLE_BY_KIND = {
  malformed: I18N_KEYS.common.bad_request,
  validation: I18N_KEYS.common.unprocessable_entity,
  conflict: I18N_KEYS.common.conflict,
  not_found: I18N_KEYS.common.not_found,
  forbidden: I18N_KEYS.common.forbidden,
} as const satisfies Record<FieldProblemKind, string>;

export interface FieldProblemInput {
  readonly kind: FieldProblemKind;
  readonly code: string;
  readonly messageKey: string;
  readonly path: string;
  readonly message: string;
  readonly permanent?: boolean;
  readonly violationCode?: string;
  readonly args?: Record<string, unknown>;
}

export function fieldProblem(input: FieldProblemInput) {
  const { kind, code, messageKey, path, message, permanent, violationCode = code, args } = input;
  return {
    kind,
    code,
    title: TITLE_BY_KIND[kind],
    messageKey,
    ...(permanent === undefined ? {} : { permanent }),
    ...(args === undefined ? {} : { args }),
    violations: [{ path, code: violationCode, message, messageKey }],
  };
}
