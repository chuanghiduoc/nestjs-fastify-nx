import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, Inject } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { BETTER_AUTH_INSTANCE } from '@nestjs-fastify-nx/infra-auth';
import type { BetterAuthInstance } from '@nestjs-fastify-nx/infra-auth';
import { createWsAuthMiddleware } from './ws-auth.adapter';

interface WsRedisEnv {
  REDIS_CACHE_HOST: string;
  REDIS_CACHE_PORT: number;
  REDIS_PUBSUB_DB: number;
  WS_CONNECTION_LIMIT_PER_IP: number;
}

// Read at module-load time so the synchronous decorator can hand a CORS function to socket.io.
// Empty allowlist in production rejects all cross-origin upgrades — never use origin: true with credentials.
const wsOrigins = (process.env['CORS_ORIGINS'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const isProd = process.env['NODE_ENV'] === 'production';

const wsCorsOrigin: (
  origin: string | undefined,
  cb: (err: Error | null, allow?: boolean) => void,
) => void = (origin, cb) => {
  if (!origin) return cb(null, true); // same-origin / non-browser
  if (wsOrigins.length > 0) return cb(null, wsOrigins.includes(origin));
  return cb(null, !isProd); // dev: allow all; prod: require explicit allowlist
};

@WebSocketGateway({
  cors: { origin: wsCorsOrigin, credentials: true },
  path: '/ws',
})
export class NotificationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnApplicationShutdown
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(NotificationGateway.name);

  private pubClient!: Redis;
  private subClient!: Redis;
  private rateLimitClient!: Redis;

  constructor(
    private readonly config: ConfigService<WsRedisEnv, true>,
    @Inject(BETTER_AUTH_INSTANCE) private readonly auth: BetterAuthInstance,
  ) {}

  afterInit(server: Server): void {
    const retryStrategy = (times: number) => Math.min(times * 100, 3000);
    const host = this.config.get('REDIS_CACHE_HOST', { infer: true });
    const port = this.config.get('REDIS_CACHE_PORT', { infer: true });

    this.pubClient = new Redis({
      host,
      port,
      db: this.config.get('REDIS_PUBSUB_DB', { infer: true }),
      retryStrategy,
    });
    this.subClient = this.pubClient.duplicate();

    this.rateLimitClient = new Redis({
      host,
      port,
      db: this.config.get('REDIS_PUBSUB_DB', { infer: true }),
      retryStrategy,
      enableOfflineQueue: false,
    });

    this.pubClient.on('error', (err: Error) =>
      this.logger.error({ err }, 'Socket.io Redis pub error'),
    );
    this.subClient.on('error', (err: Error) =>
      this.logger.error({ err }, 'Socket.io Redis sub error'),
    );
    this.rateLimitClient.on('error', (err: Error) =>
      this.logger.warn({ err }, 'Socket.io Redis rate-limit error (fail-open)'),
    );

    server.adapter(createAdapter(this.pubClient, this.subClient));
    server.use(
      createWsAuthMiddleware(this.auth, {
        redis: this.rateLimitClient,
        maxConcurrentPerIp: this.config.get('WS_CONNECTION_LIMIT_PER_IP', { infer: true }),
      }),
    );

    this.logger.log('NotificationGateway initialized with Redis adapter');
  }

  async onApplicationShutdown(): Promise<void> {
    // Guard the optional chaining — shutdown can fire before afterInit() ran.
    const closes: Promise<unknown>[] = [];
    if (this.pubClient) closes.push(this.pubClient.quit().catch(() => this.pubClient.disconnect()));
    if (this.subClient) closes.push(this.subClient.quit().catch(() => this.subClient.disconnect()));
    if (this.rateLimitClient)
      closes.push(this.rateLimitClient.quit().catch(() => this.rateLimitClient.disconnect()));
    await Promise.allSettled(closes);
  }

  handleConnection(socket: Socket): void {
    const user = socket.data['user'] as { userId: string; email: string } | undefined;
    if (!user) {
      socket.disconnect(true);
      return;
    }
    void socket.join(`user:${user.userId}`);
    this.logger.log(`Client connected: userId=${user.userId} socketId=${socket.id}`);
  }

  handleDisconnect(socket: Socket): void {
    const user = socket.data['user'] as { userId: string } | undefined;
    this.logger.log(
      `Client disconnected: userId=${user?.userId ?? 'unknown'} socketId=${socket.id}`,
    );
  }

  @SubscribeMessage('ping')
  handlePing(
    @MessageBody() _data: unknown,
    @ConnectedSocket() socket: Socket,
  ): { event: string; data: string } {
    const user = socket.data['user'] as { userId: string };
    this.logger.debug(`Ping from userId=${user?.userId}`);
    return { event: 'pong', data: 'pong' };
  }

  sendToUser(userId: string, event: string, payload: unknown): void {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  broadcast(event: string, payload: unknown): void {
    this.server.emit(event, payload);
  }
}
