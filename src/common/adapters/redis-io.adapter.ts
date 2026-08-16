import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';

/**
 * Attaches the Redis adapter to the root Socket.IO server so
 * `server.in(room).fetchSockets()/emit()` (used by SubastaGateway to
 * broadcast auction state) fan out across every backend instance instead of
 * only the one a given socket happens to be connected to. Done here, not in
 * a gateway's afterInit(), because a namespaced gateway's `server` there is
 * actually the Namespace object — only the root io.Server (available at
 * construction time, which is what this overrides) has `.adapter()`.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplicationContext,
    private readonly redis: Redis,
  ) {
    super(app);
  }

  connect() {
    const pubClient = this.redis.duplicate();
    const subClient = this.redis.duplicate();
    pubClient.on('error', (err) => this.logger.warn(`Redis adapter pub client error: ${err.message}`));
    subClient.on('error', (err) => this.logger.warn(`Redis adapter sub client error: ${err.message}`));
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
