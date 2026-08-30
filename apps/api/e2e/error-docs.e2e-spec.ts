import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { ERROR_CATALOG_ENTRIES, errorTypeSlug } from '@nestjs-fastify-nx/contracts';
import { createTestApp, type TestAppContext } from './test-app';

// RFC 9457 §3.1.1 expects a problem `type` URI to resolve to human-readable documentation. These
// specs assert the round trip: the URI an error response advertises is one the api actually serves.
describe('Error type documentation E2E', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 60_000);

  it('serves the type URI advertised by a real error response', async () => {
    const problem = await request(ctx.app.getHttpServer())
      .get('/api/v1/this-route-does-not-exist')
      .expect(404);

    const { type } = problem.body as { type: string };
    expect(type).toMatch(/^\/errors\//);

    const doc = await request(ctx.app.getHttpServer()).get(type).expect(200);

    expect(doc.headers['content-type']).toContain('text/html');
    expect(doc.text).toContain((problem.body as { code: string }).code);
  });

  it('documents every catalogued error type', async () => {
    for (const entry of ERROR_CATALOG_ENTRIES) {
      const res = await request(ctx.app.getHttpServer())
        .get(`/errors/${errorTypeSlug(entry.code)}`)
        .expect(200);

      expect(res.text).toContain(entry.code);
      expect(res.text).toContain(entry.title);
    }
  });

  it('lists all types on the index page', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/errors').expect(200);

    expect(res.headers['content-type']).toContain('text/html');
    for (const entry of ERROR_CATALOG_ENTRIES) {
      expect(res.text).toContain(`/errors/${errorTypeSlug(entry.code)}`);
    }
  });

  it('answers an unknown slug with a problem document, not a page', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/errors/not-a-real-type').expect(404);

    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  // A plain-object lookup would answer these from the prototype chain and render an empty page.
  it('does not resolve prototype keys as documentation', async () => {
    for (const slug of ['__proto__', 'constructor', 'toString']) {
      await request(ctx.app.getHttpServer()).get(`/errors/${slug}`).expect(404);
    }
  });

  it('stays outside the versioned api prefix', async () => {
    await request(ctx.app.getHttpServer()).get('/api/v1/errors/not-found').expect(404);
  });
});
