import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { Client } from 'pg';
import {
  createTestApp,
  cookieHeaderFromSetCookies,
  resetRateLimitBudget,
  seedE2eStorageObject,
  type TestAppContext,
} from './test-app';

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('Upload E2E', () => {
  let ctx: TestAppContext;
  let cookie: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 60_000);

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await ctx.cleaner.truncateAll();
    await resetRateLimitBudget();
    const email = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const signUp = await request(ctx.app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email, password: 'password123', name: 'Up' });
    cookie = cookieHeaderFromSetCookies(signUp.headers['set-cookie']);
  });

  describe('POST /api/v1/upload/presign', () => {
    it('returns 201 with policy fields + bucket + key + expiresAt for an allowed MIME', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/api/v1/upload/presign')
        .set('Cookie', cookie)
        .send({ contentType: 'image/png' })
        .expect(201);

      expect(typeof res.body.url).toBe('string');
      expect(res.body.url.length).toBeGreaterThan(0);
      expect(typeof res.body.fields).toBe('object');
      expect(res.body.fields['Content-Type']).toBe('image/png');
      expect(res.body.key).toMatch(/^uploads\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/i);
      expect(typeof res.body.bucket).toBe('string');
      expect(typeof res.body.expiresAt).toBe('string');
      // maxBytes must mirror UPLOAD_MAX_FILE_BYTES wired in test-app.ts (5 MB).
      expect(res.body.maxBytes).toBe(5 * 1024 * 1024);
    });

    it('returns 422 validation_failed when MIME is outside the allow-list', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/api/v1/upload/presign')
        .set('Cookie', cookie)
        .send({ contentType: 'application/x-msdownload' })
        .expect(422);

      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body.code).toBe('validation_failed');
    });

    it('returns 422 validation_failed when contentType is missing', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/api/v1/upload/presign')
        .set('Cookie', cookie)
        .send({})
        .expect(422);

      expect(res.body.code).toBe('validation_failed');
    });

    it('returns 401 problem+json without a session cookie', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/api/v1/upload/presign')
        .send({ contentType: 'image/png' })
        .expect(401);

      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body.code).toBe('unauthorized');
    });
  });

  describe('POST /api/v1/upload/confirm', () => {
    it('finalizes the object and persists durable verification state', async () => {
      const presign = await request(ctx.app.getHttpServer())
        .post('/api/v1/upload/presign')
        .set('Cookie', cookie)
        .send({ contentType: 'image/png' })
        .expect(201);
      seedE2eStorageObject(presign.body.key, PNG_HEADER, 'image/png');

      const res = await request(ctx.app.getHttpServer())
        .post('/api/v1/upload/confirm')
        .set('Cookie', cookie)
        .send({ key: presign.body.key })
        .expect(200);

      expect(res.body.key).toMatch(/^files\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/i);

      // Read as the owner: the app connects as a NOBYPASSRLS role, so a query issued
      // outside a request has no organization context and row-level security hides the row.
      const admin = new Client({ connectionString: process.env['E2E_ADMIN_DATABASE_URL'] });
      await admin.connect();
      try {
        const { rows } = await admin.query(
          `SELECT sf."key", sf.status, sf.size, sf."organizationId", s."activeOrganizationId"
             FROM stored_files sf
             JOIN sessions s ON s."userId" = sf."userId"
            WHERE sf."sourceKey" = $1`,
          [presign.body.key],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ key: res.body.key, status: 'VERIFYING', size: 8 });
        expect(rows[0].organizationId).toBe(rows[0].activeOrganizationId);
      } finally {
        await admin.end();
      }
    });

    it('returns 422 when key violates the uploads/<id>.<ext> pattern', async () => {
      // Path traversal attempt — regex anchors must reject this before the
      // controller ever calls storage.head().
      const res = await request(ctx.app.getHttpServer())
        .post('/api/v1/upload/confirm')
        .set('Cookie', cookie)
        .send({ key: '../etc/passwd' })
        .expect(422);

      expect(res.body.code).toBe('validation_failed');
    });

    it('returns 422 when key omits the uploads/ prefix', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/api/v1/upload/confirm')
        .set('Cookie', cookie)
        .send({ key: 'random-file.png' })
        .expect(422);

      expect(res.body.code).toBe('validation_failed');
    });

    it('returns 404 problem+json when key matches pattern but object does not exist on S3', async () => {
      const presign = await request(ctx.app.getHttpServer())
        .post('/api/v1/upload/presign')
        .set('Cookie', cookie)
        .send({ contentType: 'image/png' })
        .expect(201);

      const res = await request(ctx.app.getHttpServer())
        .post('/api/v1/upload/confirm')
        .set('Cookie', cookie)
        .send({ key: presign.body.key })
        .expect(404);

      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body.code).toBe('not_found');
    });

    it('returns 401 problem+json without a session cookie', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/v1/upload/confirm')
        .send({ key: 'uploads/abc.png' })
        .expect(401);
    });
  });

  describe('DELETE /api/v1/upload/:id', () => {
    async function uploadFile(withCookie: string): Promise<{ id: string; key: string }> {
      const presign = await request(ctx.app.getHttpServer())
        .post('/api/v1/upload/presign')
        .set('Cookie', withCookie)
        .send({ contentType: 'image/png' })
        .expect(201);
      seedE2eStorageObject(presign.body.key, PNG_HEADER, 'image/png');

      const confirm = await request(ctx.app.getHttpServer())
        .post('/api/v1/upload/confirm')
        .set('Cookie', withCookie)
        .send({ key: presign.body.key })
        .expect(200);

      const admin = new Client({ connectionString: process.env['E2E_ADMIN_DATABASE_URL'] });
      await admin.connect();
      try {
        const { rows } = await admin.query('SELECT id FROM stored_files WHERE "key" = $1', [
          confirm.body.key,
        ]);
        return { id: rows[0].id, key: confirm.body.key };
      } finally {
        await admin.end();
      }
    }

    it('soft-deletes the file, keeps the object, and is idempotent', async () => {
      const file = await uploadFile(cookie);

      await request(ctx.app.getHttpServer())
        .delete(`/api/v1/upload/${file.id}`)
        .set('Cookie', cookie)
        .expect(204);

      const admin = new Client({ connectionString: process.env['E2E_ADMIN_DATABASE_URL'] });
      await admin.connect();
      try {
        const { rows } = await admin.query('SELECT "deletedAt" FROM stored_files WHERE id = $1', [
          file.id,
        ]);
        expect(rows).toHaveLength(1);
        expect(rows[0].deletedAt).toBeInstanceOf(Date);

        // Repeating the call must not restamp deletedAt — that would extend the retention window.
        await request(ctx.app.getHttpServer())
          .delete(`/api/v1/upload/${file.id}`)
          .set('Cookie', cookie)
          .expect(404);

        const after = await admin.query('SELECT "deletedAt" FROM stored_files WHERE id = $1', [
          file.id,
        ]);
        expect(after.rows[0].deletedAt).toEqual(rows[0].deletedAt);
      } finally {
        await admin.end();
      }
    });

    it('answers 404 — never 403 — for a file owned by another user', async () => {
      const file = await uploadFile(cookie);

      const otherEmail = `up-other-${Date.now()}@example.com`;
      const otherSignUp = await request(ctx.app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: otherEmail, password: 'password123', name: 'Other' });
      const otherCookie = cookieHeaderFromSetCookies(otherSignUp.headers['set-cookie']);

      const res = await request(ctx.app.getHttpServer())
        .delete(`/api/v1/upload/${file.id}`)
        .set('Cookie', otherCookie)
        .expect(404);

      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body.code).toBe('not_found');
    });

    it('rejects a non-UUIDv7 id before reaching the handler', async () => {
      await request(ctx.app.getHttpServer())
        .delete('/api/v1/upload/6f9619ff-8b86-d011-b42d-00c04fc964ff')
        .set('Cookie', cookie)
        .expect(400);
    });

    it('returns 401 without a session cookie', async () => {
      await request(ctx.app.getHttpServer())
        .delete('/api/v1/upload/019dd1a5-9235-70db-8d57-54ef901d8185')
        .expect(401);
    });
  });

  describe('organization permissions', () => {
    // The signer owns their personal organization, so the happy paths above all run as `owner`.
    // Demoting the membership is what proves PermissionGuard is actually consulted rather than
    // every caller simply holding every permission.
    it('refuses upload to a member whose role lacks file:create', async () => {
      const admin = new Client({ connectionString: process.env['E2E_ADMIN_DATABASE_URL'] });
      await admin.connect();
      try {
        await admin.query(`UPDATE members SET role = 'viewer'`);
      } finally {
        await admin.end();
      }

      const res = await request(ctx.app.getHttpServer())
        .post('/api/v1/upload/presign')
        .set('Cookie', cookie)
        .send({ contentType: 'image/png' })
        .expect(403);

      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body.code).toBe('forbidden');
    });

    it('grants access again through a tenant-defined custom role', async () => {
      const admin = new Client({ connectionString: process.env['E2E_ADMIN_DATABASE_URL'] });
      await admin.connect();
      try {
        const { rows } = await admin.query('SELECT "organizationId" FROM members LIMIT 1');
        await admin.query(
          `INSERT INTO organization_roles ("organizationId", role, permission) VALUES ($1, 'uploader', $2)`,
          [rows[0].organizationId, JSON.stringify({ file: ['create'] })],
        );
        await admin.query(`UPDATE members SET role = 'uploader'`);
      } finally {
        await admin.end();
      }

      await request(ctx.app.getHttpServer())
        .post('/api/v1/upload/presign')
        .set('Cookie', cookie)
        .send({ contentType: 'image/png' })
        .expect(201);
    });
  });
});
