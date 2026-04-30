import { describe, it, expect } from 'vitest';
import { Email } from './email.vo';

describe('Email value object', () => {
  it('normalizes to lowercase', () => {
    const email = Email.create('USER@EXAMPLE.COM');
    expect(email.toString()).toBe('user@example.com');
  });

  it('trims whitespace', () => {
    const email = Email.create('  user@example.com  ');
    expect(email.toString()).toBe('user@example.com');
  });

  it('throws for invalid format', () => {
    expect(() => Email.create('not-an-email')).toThrow('Invalid email');
    expect(() => Email.create('')).toThrow();
  });

  it('accepts valid emails', () => {
    expect(() => Email.create('a@b.co')).not.toThrow();
    expect(() => Email.create('user+tag@domain.org')).not.toThrow();
  });
});
