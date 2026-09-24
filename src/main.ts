// Must load before any other import — see instrument.ts for why.
import './instrument';

import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { origenesPermitidos } from './config/origenes';
import { RedisIoAdapter } from './common/adapters/redis-io.adapter';
import { REDIS_CLIENT } from './redis/redis.constants';

async function bootstrap() {
  // bufferLogs holds Nest's own bootstrap logs until the Pino logger below
  // is attached, so they go through the same pipeline instead of console.log.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService);

  // Behind a hosting load balancer (Render, Koyeb, Fly…) every request arrives
  // from the proxy's IP. Trusting exactly that many hops makes req.ip the real
  // client — otherwise the rate limiter would throttle all users together.
  // Never `true`: that would let clients spoof X-Forwarded-For.
  const trustProxyHops = Number(config.get('TRUST_PROXY_HOPS', 0));
  if (trustProxyHops > 0) app.getHttpAdapter().getInstance().set('trust proxy', trustProxyHops);

  // CSP off: this is a JSON API plus a Swagger UI page, and a strict default
  // CSP blocks Swagger's inline scripts. The other headers (HSTS, nosniff,
  // frameguard, etc.) still apply.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(compression());
  app.enableCors({ origin: origenesPermitidos(config.get<string>('CORS_ORIGIN')), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );

  // Lets the subasta gateway's broadcasts reach sockets on every backend
  // instance, not just the one each socket happens to be connected to —
  // see RedisIoAdapter for why this can't be set up inside the gateway itself.
  const redisIoAdapter = new RedisIoAdapter(app, app.get(REDIS_CLIENT));
  redisIoAdapter.connect();
  app.useWebSocketAdapter(redisIoAdapter);

  // Every documented route still requires a valid JWT, but the endpoint/DTO
  // map itself is useful recon for an attacker — keep it out of production.
  if (config.get('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('ProcureOS API')
      .setDescription('API del backend de ProcureOS — auth, requerimientos, ofertas, contratos, subasta en vivo, etc.')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  const port = config.get('PORT', 3001);
  await app.listen(port);
  app.get(Logger).log(`ProcureOS API listening on http://localhost:${port} (docs at /docs)`, 'Bootstrap');
}
bootstrap();
