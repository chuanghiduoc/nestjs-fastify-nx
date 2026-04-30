export abstract class ValueObject<T> {
  protected constructor(protected readonly value: T) {}

  equals(other: ValueObject<T>): boolean {
    if (other === null || other === undefined) return false;
    if (other.constructor !== this.constructor) return false;
    return JSON.stringify(this.value) === JSON.stringify(other.value);
  }

  toString(): string {
    return String(this.value);
  }
}
