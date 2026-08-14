import { Controller, Get, Inject, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import type Redis from 'ioredis';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.constants';

// What a load balancer / uptime monitor actually needs to know: not just
// "the Node process is alive" (the root route already answers that), but
// "can this instance actually serve a request right now" — so it pings the
// two hard dependencies every request goes through and reflects that in
// both the HTTP status (200/503) and the body. Skips the rate limiter
// specifically because it's itself Redis-backed — without this, a Redis
// outage would make the throttler guard throw before this handler ever
// runs, turning a diagnosable 503 into an opaque 500 from the wrong layer.
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private prisma: PrismaService,
    @Inject(REDIS_CLIENT) private redis: Redis,
  ) {}

  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const [db, redis] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.ping(),
    ]);

    const status = {
      db: db.status === 'fulfilled' ? 'ok' : 'error',
      redis: redis.status === 'fulfilled' ? 'ok' : 'error',
    };
    const healthy = status.db === 'ok' && status.redis === 'ok';
    res.status(healthy ? 200 : 503);

    return { status: healthy ? 'ok' : 'error', ...status, timestamp: new Date().toISOString() };
  }
}
