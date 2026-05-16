import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, cookieHeaderFromSetCookies, type TestAppContext } from './test-app';

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
      expect(res.body.key).toMatch(/^uploads\/[A-Za-z0-9._-]+\.png$/);
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
      const res = await request(ctx.app.getHttpServer())
        .post('/api/v1/upload/confirm')
        .set('Cookie', cookie)
        .send({ key: 'uploads/nonexistent-019dd1a5-1234.png' })
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
});
