import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import mercurius from 'mercurius';
import { GRAPHQL_MAX_QUERY_DEPTH } from './graphql.module';

// Exercises the real Mercurius query-depth enforcement (SEC-4) rather than only asserting the
// option is passed — a typo'd option name would still "pass" a wiring-only test.
const schema = `
  type Level {
    level: Level
    value: String
  }

  type Query {
    level0: Level
  }
`;

// determineDepth counts the operation root (depth 0) + `level0` (1) + one level per nested
// `level` selection + the terminal scalar selection. Building it this way keeps the exact
// depth traceable to Mercurius' own algorithm instead of a hand-counted guess.
function nestedQuery(extraLevels: number): string {
  let innermost = 'value';
  for (let i = 0; i < extraLevels; i++) {
    innermost = `level { ${innermost} }`;
  }
  return `{ level0 { ${innermost} } }`;
}

async function buildServer(): Promise<FastifyInstance> {
  const fastify = Fastify();
  await fastify.register(mercurius, {
    schema,
    resolvers: { Query: { level0: () => null } },
    graphiql: false,
    queryDepth: GRAPHQL_MAX_QUERY_DEPTH,
  });
  return fastify;
}

describe('GraphQL query depth limit', () => {
  let fastify: FastifyInstance;

  afterEach(async () => {
    await fastify?.close();
  });

  it('rejects a query deeper than GRAPHQL_MAX_QUERY_DEPTH', async () => {
    fastify = await buildServer();
    const query = nestedQuery(GRAPHQL_MAX_QUERY_DEPTH - 1); // total depth = limit + 1

    const response = await fastify.inject({
      method: 'POST',
      url: '/graphql',
      payload: { query },
    });

    const body = response.json();
    expect(response.statusCode).toBe(400);
    expect(body.errors?.[0]?.message).toMatch(/exceeds the query depth limit/i);
  });

  it('allows a query at exactly GRAPHQL_MAX_QUERY_DEPTH', async () => {
    fastify = await buildServer();
    const query = nestedQuery(GRAPHQL_MAX_QUERY_DEPTH - 2); // total depth = limit

    const response = await fastify.inject({
      method: 'POST',
      url: '/graphql',
      payload: { query },
    });

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.errors).toBeUndefined();
  });
});
