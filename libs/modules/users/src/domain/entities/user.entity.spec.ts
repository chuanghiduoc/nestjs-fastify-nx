import { describe, it, expect } from 'vitest';
import { User, UserRole, UserStatus } from './user.entity';
import { Email } from '../value-objects/email.vo';
import { UserRegistered } from '../events/user-registered.event';

describe('User entity', () => {
  const email = Email.create('test@example.com');

  it('creates with USER role and ACTIVE status', () => {
    const user = User.create(email);
    expect(user.role).toBe(UserRole.USER);
    expect(user.status).toBe(UserStatus.ACTIVE);
    expect(user.id).toBeDefined();
  });

  it('isActive returns true for ACTIVE users', () => {
    const user = User.create(email);
    expect(user.isActive()).toBe(true);
  });

  it('isActive returns false for BANNED users', () => {
    const user = User.reconstitute({
      id: '01ABCDEF',
      email: 'test@example.com',
      name: 'Test User',
      role: UserRole.USER,
      status: UserStatus.BANNED,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(user.isActive()).toBe(false);
  });

  it('pullDomainEvents returns and clears events', () => {
    const user = User.create(email);
    user.addDomainEvent(new UserRegistered(user.id, { email: 'test@example.com' }));
    const events = user.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('users.registered');
    expect(user.pullDomainEvents()).toHaveLength(0);
  });
});
