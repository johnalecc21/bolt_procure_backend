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

async function bootstrap() {
  // bufferLogs holds Nest's own bootstrap logs until the Pino logger below
  // is attached, so they go through the same pipeline instead of console.log.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService);

  // CSP off: this is a JSON API plus a Swagger UI page, and a strict default
  // CSP blocks Swagger's inline scripts. The other headers (HSTS, nosniff,
  // frameguard, etc.) still apply.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(compression());
  app.enableCors({ origin: config.get('CORS_ORIGIN', 'http://localhost:5173'), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('ProcureOS API')
    .setDescription('API del backend de ProcureOS — auth, requerimientos, ofertas, contratos, subasta en vivo, etc.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = config.get('PORT', 3001);
  await app.listen(port);
  app.get(Logger).log(`ProcureOS API listening on http://localhost:${port} (docs at /docs)`, 'Bootstrap');
}
bootstrap();
