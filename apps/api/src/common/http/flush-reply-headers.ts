import type { FastifyReply } from 'fastify';

// Call immediately before reply.hijack(). hijack() detaches the reply from Fastify's send pipeline,
// which is the only thing that flushes headers buffered via reply.header() (e.g. @fastify/cors's
// Access-Control-* set in its onRequest hook, or x-request-id/x-correlation-id). A downstream raw
// writer such as Better Auth's node handler only merges its own headers onto reply.raw, so anything
// still buffered is dropped from the response. Copying them onto the raw response first keeps them;
// the raw writer's own headers still win because it calls setHeader after this.
export function flushBufferedReplyHeaders(reply: FastifyReply): void {
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (value !== undefined) reply.raw.setHeader(name, value);
  }
}
