import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

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
  // eslint-disable-next-line no-console
  console.log(`ProcureOS API listening on http://localhost:${port} (docs at /docs)`);
}
bootstrap();
