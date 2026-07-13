import { isDeepStrictEqual } from 'node:util';

export abstract class ValueObject<T> {
  protected constructor(protected readonly value: T) {}

  equals(other: ValueObject<T>): boolean {
    if (other === null || other === undefined) return false;
    if (other.constructor !== this.constructor) return false;
    return isDeepStrictEqual(this.value, other.value);
  }

  toString(): string {
    return String(this.value);
  }
}
