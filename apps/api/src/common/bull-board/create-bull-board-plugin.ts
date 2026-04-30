import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import type { FastifyInstance } from 'fastify';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../app/constants/queue.constants';

export interface BullBoardOptions {
  user: string;
  password: string;
  basePath: string;
  redisHost: string;
  redisPort: number;
  queuePrefix: string;
}

export function createBullBoardPlugin(opts: BullBoardOptions) {
  return async function bullBoardPlugin(fastify: FastifyInstance) {
    const serverAdapter = new FastifyAdapter();
    serverAdapter.setBasePath(opts.basePath);

    const rawQueues = Object.values(QUEUE_NAMES).map(
      (name) =>
        new Queue(name, {
          connection: { host: opts.redisHost, port: opts.redisPort },
          prefix: opts.queuePrefix,
        }),
    );
    const queues = rawQueues.map((q) => new BullMQAdapter(q));

    createBullBoard({ queues, serverAdapter });

    fastify.addHook('onClose', async () => {
      await Promise.all(rawQueues.map((q) => q.close()));
    });

    fastify.addHook('onRequest', async (request, reply) => {
      const authHeader = request.headers['authorization'];
      if (!authHeader?.startsWith('Basic ')) {
        reply.header('WWW-Authenticate', 'Basic realm="Bull Board"');
        reply.status(401).send('Unauthorized');
        return;
      }
      const decoded = Buffer.from(authHeader.slice('Basic '.length), 'base64').toString();
      const colonIdx = decoded.indexOf(':');
      const user = decoded.slice(0, colonIdx);
      const password = colonIdx === -1 ? '' : decoded.slice(colonIdx + 1);
      if (user !== opts.user || password !== opts.password) {
        reply.header('WWW-Authenticate', 'Basic realm="Bull Board"');
        reply.status(401).send('Unauthorized');
        return;
      }
    });

    await fastify.register(serverAdapter.registerPlugin(), {
      prefix: opts.basePath,
      logLevel: 'silent',
    });
  };
}
