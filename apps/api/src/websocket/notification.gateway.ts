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

// Origin allowlist is read at module-load time from CORS_ORIGINS so the
// @WebSocketGateway decorator (evaluated synchronously at class definition)
// can hand a CORS function to socket.io. In production, an empty allowlist
// means we reject all cross-origin upgrades — credential-bearing cookies
// must never travel with `origin: true` (reflect-any), which would let any
// site initiate authenticated socket sessions on behalf of the user.
const wsOrigins = (process.env['CORS_ORIGINS'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const isProd = process.env['NODE_ENV'] === 'production';

const wsCorsOrigin: (
  origin: string | undefined,
  cb: (err: Error | null, allow?: boolean) => void,
) => void = (origin, cb) => {
  // Same-origin / non-browser clients (curl, server-to-server) — allow.
  if (!origin) return cb(null, true);
  if (wsOrigins.length > 0) {
    return cb(null, wsOrigins.includes(origin));
  }
  // Dev convenience: when no allowlist is configured, accept anything outside
  // production. In production, require an explicit allowlist.
  return cb(null, !isProd);
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

  constructor(
    private readonly config: ConfigService,
    @Inject(BETTER_AUTH_INSTANCE) private readonly auth: BetterAuthInstance,
  ) {}

  afterInit(server: Server): void {
    const retryStrategy = (times: number) => Math.min(times * 100, 3000);

    this.pubClient = new Redis({
      host: this.config.get<string>('REDIS_CACHE_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_CACHE_PORT', 6379),
      db: this.config.get<number>('REDIS_PUBSUB_DB', 2),
      retryStrategy,
    });
    this.subClient = this.pubClient.duplicate();

    this.pubClient.on('error', (err: Error) =>
      this.logger.error({ err }, 'Socket.io Redis pub error'),
    );
    this.subClient.on('error', (err: Error) =>
      this.logger.error({ err }, 'Socket.io Redis sub error'),
    );

    server.adapter(createAdapter(this.pubClient, this.subClient));
    server.use(createWsAuthMiddleware(this.auth));

    this.logger.log('NotificationGateway initialized with Redis adapter');
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.pubClient.quit(), this.subClient.quit()]);
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
