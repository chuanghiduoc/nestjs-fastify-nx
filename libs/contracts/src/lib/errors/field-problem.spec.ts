import { describe, expect, it } from 'vitest';
import { I18N_KEYS } from '../i18n-keys';
import { fieldProblem } from './field-problem';

describe('fieldProblem', () => {
  it('derives the title from the kind and mirrors code and key onto the violation', () => {
    expect(
      fieldProblem({
        kind: 'not_found',
        code: 'widget_not_found',
        messageKey: 'errors.widget.not_found',
        path: 'id',
        message: 'Widget not found',
      }),
    ).toEqual({
      kind: 'not_found',
      code: 'widget_not_found',
      title: I18N_KEYS.common.not_found,
      messageKey: 'errors.widget.not_found',
      violations: [
        {
          path: 'id',
          code: 'widget_not_found',
          message: 'Widget not found',
          messageKey: 'errors.widget.not_found',
        },
      ],
    });
  });

  it('carries permanent only when given', () => {
    const base = { code: 'c', messageKey: 'k', path: 'p', message: 'm' };
    expect(fieldProblem({ ...base, kind: 'conflict', permanent: false })).toHaveProperty(
      'permanent',
      false,
    );
    expect(fieldProblem({ ...base, kind: 'validation' })).not.toHaveProperty('permanent');
  });

  it('lets the violation carry its own code and attaches args', () => {
    const problem = fieldProblem({
      kind: 'validation',
      code: 'top_level',
      violationCode: 'field_level',
      messageKey: 'k',
      path: 'p',
      message: 'm',
      args: { size: 1 },
    });
    expect(problem.code).toBe('top_level');
    expect(problem.violations[0]?.code).toBe('field_level');
    expect(problem.args).toEqual({ size: 1 });
  });
});
