import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { GRAPHQL_PATH } from '../src/common/http/global-prefix';
import { createTestApp, cookieHeaderFromSetCookies, type TestAppContext } from './test-app';

const REQUEST_ID_FORMAT = /^[a-f0-9]{32}$/;

describe('GraphQL E2E', () => {
  let ctx: TestAppContext;
  let cookie: string;
  let userEmail: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 60_000);

  beforeEach(async () => {
    await ctx.cleaner.truncateAll();
    userEmail = `gql-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const signUp = await request(ctx.app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: userEmail, password: 'password123', name: 'GraphQL User' });
    cookie = cookieHeaderFromSetCookies(signUp.headers['set-cookie']);
  });

  it('returns the GraphQL error envelope for an invalid query instead of a problem document', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post(GRAPHQL_PATH)
      .set('Cookie', cookie)
      .send({ query: '{ me { nope } }' })
      .expect(400);

    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.data).toBeNull();
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(typeof res.body.errors[0].message).toBe('string');
    expect(res.body.errors[0].message).toContain('nope');
    expect(res.body).not.toHaveProperty('code');
    expect(res.headers['x-request-id']).toMatch(REQUEST_ID_FORMAT);
  });

  it('resolves `me` for a signed-in user and stamps the request id', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post(GRAPHQL_PATH)
      .set('Cookie', cookie)
      .send({ query: '{ me { id email } }' })
      .expect(200);

    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.me.email).toBe(userEmail);
    expect(typeof res.body.data.me.id).toBe('string');
    expect(res.headers['x-request-id']).toMatch(REQUEST_ID_FORMAT);
    expect(res.headers['x-correlation-id']).toBe(res.headers['x-request-id']);
  });

  it('honours a caller-owned X-Correlation-Id on the GraphQL path', async () => {
    const correlationId = `gql-${Date.now()}`;
    const res = await request(ctx.app.getHttpServer())
      .post(GRAPHQL_PATH)
      .set('Cookie', cookie)
      .set('X-Correlation-Id', correlationId)
      .send({ query: '{ me { id } }' })
      .expect(200);

    expect(res.headers['x-correlation-id']).toBe(correlationId);
    expect(res.headers['x-request-id']).toMatch(REQUEST_ID_FORMAT);
  });
});
