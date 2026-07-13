import { describe, expect, it } from 'vitest';
import { ValueObject } from './value-object';

class TestValue extends ValueObject<Record<string, unknown>> {
  constructor(value: Record<string, unknown>) {
    super(value);
  }
}

class DifferentValue extends ValueObject<Record<string, unknown>> {
  constructor(value: Record<string, unknown>) {
    super(value);
  }
}

describe('ValueObject', () => {
  it('compares object values independently of property insertion order', () => {
    expect(
      new TestValue({ first: 1, second: 2 }).equals(new TestValue({ second: 2, first: 1 })),
    ).toBe(true);
  });

  it('does not equate different value-object classes', () => {
    expect(new TestValue({ value: 1 }).equals(new DifferentValue({ value: 1 }))).toBe(false);
  });

  it('compares nested built-in values without JSON coercion', () => {
    expect(
      new TestValue({ at: new Date('2026-07-14T00:00:00.000Z'), bytes: Buffer.from('a') }).equals(
        new TestValue({ at: new Date('2026-07-14T00:00:00.000Z'), bytes: Buffer.from('a') }),
      ),
    ).toBe(true);
  });
});
