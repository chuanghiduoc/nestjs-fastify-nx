import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { Client } from 'pg';
import {
  createTestApp,
  cookieHeaderFromSetCookies,
  resetRateLimitBudget,
  type TestAppContext,
} from './test-app';

interface OutboxRow {
  eventType: string;
  aggregateId: string;
  organizationId: string | null;
  payload: { payload: Record<string, unknown> };
}

async function withAdmin<R>(fn: (admin: Client) => Promise<R>): Promise<R> {
  const admin = new Client({ connectionString: process.env['E2E_ADMIN_DATABASE_URL'] });
  await admin.connect();
  try {
    return await fn(admin);
  } finally {
    await admin.end();
  }
}

function outboxOf(admin: Client, eventType: string): Promise<OutboxRow[]> {
  return admin
    .query<OutboxRow>(
      'SELECT "eventType", "aggregateId", "organizationId", payload FROM outbox_events WHERE "eventType" = $1 ORDER BY "createdAt"',
      [eventType],
    )
    .then((res) => res.rows);
}

describe('Organizations E2E', () => {
  let ctx: TestAppContext;
  let cookie: string;
  let email: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 60_000);

  beforeEach(async () => {
    await ctx.cleaner.truncateAll();
    await resetRateLimitBudget();
    email = `org-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const signUp = await request(ctx.app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email, password: 'password123', name: 'Org Owner' });
    cookie = cookieHeaderFromSetCookies(signUp.headers['set-cookie']);
  });

  describe('personal organization bootstrap', () => {
    it('creates one organization with the signer as owner and pins it on the session', async () => {
      await withAdmin(async (admin) => {
        const { rows } = await admin.query(
          `SELECT o.slug, m.role, s."activeOrganizationId", o.id AS org_id
             FROM organizations o
             JOIN members m ON m."organizationId" = o.id
             JOIN sessions s ON s."userId" = m."userId"`,
        );

        expect(rows).toHaveLength(1);
        expect(rows[0].role).toBe('owner');
        expect(rows[0].activeOrganizationId).toBe(rows[0].org_id);
      });
    });

    it('does not create a second organization when the same user signs in again', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email, password: 'password123' })
        .expect(200);

      await withAdmin(async (admin) => {
        const { rows } = await admin.query('SELECT count(*)::int AS n FROM organizations');
        expect(rows[0].n).toBe(1);
      });
    });
  });

  describe('outbox triggers', () => {
    it('emits organizations.created and member_added stamped with the tenant', async () => {
      await withAdmin(async (admin) => {
        const created = await outboxOf(admin, 'organizations.created');
        const added = await outboxOf(admin, 'organizations.member_added');

        expect(created).toHaveLength(1);
        expect(created[0].organizationId).toBe(created[0].aggregateId);
        expect(created[0].payload.payload).toMatchObject({ name: 'Org Owner' });

        expect(added).toHaveLength(1);
        expect(added[0].organizationId).toBe(added[0].aggregateId);
        expect(added[0].payload.payload).toMatchObject({ role: 'owner' });
      });
    });

    it('emits member_removed when a member leaves', async () => {
      await withAdmin(async (admin) => {
        await admin.query('DELETE FROM members');

        const removed = await outboxOf(admin, 'organizations.member_removed');
        expect(removed).toHaveLength(1);
        expect(removed[0].payload.payload).toMatchObject({ role: 'owner' });
      });
    });

    // Deleting an organization cascades its members. Emitting one member_removed per member would
    // bury the single organizations.deleted event that actually describes what happened.
    it('emits only organizations.deleted when the organization itself is removed', async () => {
      await withAdmin(async (admin) => {
        await admin.query('DELETE FROM organizations');

        const removed = await outboxOf(admin, 'organizations.member_removed');
        const deleted = await outboxOf(admin, 'organizations.deleted');

        expect(removed).toHaveLength(0);
        expect(deleted).toHaveLength(1);
        expect(deleted[0].organizationId).toBeNull();
      });
    });
  });

  describe('invitation flow', () => {
    it('creates a pending invitation scoped to the inviting organization', async () => {
      const inviteeEmail = `invitee-${Date.now()}@example.com`;

      const res = await request(ctx.app.getHttpServer())
        .post('/api/auth/organization/invite-member')
        .set('Cookie', cookie)
        .send({ email: inviteeEmail, role: 'member' })
        .expect(200);

      expect(res.body.status).toBe('pending');

      await withAdmin(async (admin) => {
        const { rows } = await admin.query(
          'SELECT i.email, i.status, i."organizationId", s."activeOrganizationId" FROM invitations i JOIN sessions s ON true',
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].email).toBe(inviteeEmail);
        expect(rows[0].status).toBe('pending');
        expect(rows[0].organizationId).toBe(rows[0].activeOrganizationId);
      });
    });

    it('rejects an invitation attempt without a session', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/auth/organization/invite-member')
        .send({ email: 'nobody@example.com', role: 'member' })
        .expect(401);
    });

    it('adds the invitee to the inviting organization on accept', async () => {
      const inviteeEmail = `invitee-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

      const invite = await request(ctx.app.getHttpServer())
        .post('/api/auth/organization/invite-member')
        .set('Cookie', cookie)
        .send({ email: inviteeEmail, role: 'member' })
        .expect(200);

      await request(ctx.app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: inviteeEmail, password: 'password123', name: 'Invitee' })
        .expect(200);

      // Better Auth refuses to accept an invitation from an unverified mailbox whenever the
      // invitation id is database-generated (this repo sets advanced.database.generateId: false).
      // That is the control that stops someone guessing an id and joining an organization they
      // were never invited to, so the test verifies the mailbox instead of disabling the check.
      await withAdmin((admin) =>
        admin.query('UPDATE users SET "emailVerified" = true WHERE email = $1', [inviteeEmail]),
      );

      const inviteeSignIn = await request(ctx.app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email: inviteeEmail, password: 'password123' })
        .expect(200);
      const inviteeCookie = cookieHeaderFromSetCookies(inviteeSignIn.headers['set-cookie']);

      await request(ctx.app.getHttpServer())
        .post('/api/auth/organization/accept-invitation')
        .set('Cookie', inviteeCookie)
        .send({ invitationId: invite.body.id })
        .expect(200);

      await withAdmin(async (admin) => {
        const { rows } = await admin.query(
          `SELECT m.role, u.email
             FROM members m
             JOIN users u ON u.id = m."userId"
            WHERE m."organizationId" = $1
            ORDER BY m."createdAt"`,
          [invite.body.organizationId],
        );

        // The invitee keeps their own personal organization; this asserts they also joined the
        // inviting one, rather than the accept silently switching organizations.
        expect(rows).toHaveLength(2);
        expect(rows.map((r: { email: string }) => r.email)).toContain(inviteeEmail);
        expect(rows.find((r: { email: string }) => r.email === inviteeEmail)?.role).toBe('member');

        const invitation = await admin.query('SELECT status FROM invitations WHERE id = $1', [
          invite.body.id,
        ]);
        expect(invitation.rows[0].status).toBe('accepted');
      });
    });
  });
});
