import { describe, expect, it } from 'vitest';
import { UserLoggedIn } from './user-logged-in.event';
import { UserLoggedOut } from './user-logged-out.event';

describe('session domain events', () => {
  it('builds stable event envelopes', () => {
    const login = new UserLoggedIn('u1', { sessionId: 's1' });
    const logout = new UserLoggedOut('u1', { tokenId: 't1' });
    expect(login).toMatchObject({ aggregateId: 'u1', eventType: 'users.logged_in' });
    expect(logout).toMatchObject({ aggregateId: 'u1', eventType: 'users.logged_out' });
    expect(login.eventId).toBeTruthy();
    expect(logout.occurredAt).toBeInstanceOf(Date);
  });
});
