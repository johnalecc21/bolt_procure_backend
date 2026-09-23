import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { SentryModule } from '@sentry/nestjs/setup';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import type { Params } from 'nestjs-pino';
import type { TransportTargetOptions } from 'pino';
import type { IncomingMessage, ServerResponse } from 'http';
import Redis from 'ioredis';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { SupabaseModule } from './supabase/supabase.module';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './storage/storage.module';
import { envValidationSchema } from './config/env.validation';
import { REDIS_CLIENT } from './redis/redis.constants';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { PortalGuard } from './common/guards/portal.guard';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { UsuariosModule } from './usuarios/usuarios.module';
import { RequerimientosModule } from './requerimientos/requerimientos.module';
import { AprobacionesModule } from './aprobaciones/aprobaciones.module';
import { MatrizAprobacionModule } from './matriz-aprobacion/matriz-aprobacion.module';
import { ProveedoresModule } from './proveedores/proveedores.module';
import { HomologacionModule } from './homologacion/homologacion.module';
import { OfertasModule } from './ofertas/ofertas.module';
import { AdjudicacionModule } from './adjudicacion/adjudicacion.module';
import { ContratosModule } from './contratos/contratos.module';
import { SeguimientoModule } from './seguimiento/seguimiento.module';
import { DisputasModule } from './disputas/disputas.module';
import { InvitacionesModule } from './invitaciones/invitaciones.module';
import { PagosModule } from './pagos/pagos.module';
import { NotificacionesModule } from './notificaciones/notificaciones.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { SubastaModule } from './subasta/subasta.module';
import { InternoModule } from './interno/interno.module';
import { PreguntasModule } from './preguntas/preguntas.module';
import { VencimientosModule } from './vencimientos/vencimientos.module';
import { AnaliticaModule } from './analitica/analitica.module';
import { EvaluacionesModule } from './evaluaciones/evaluaciones.module';
import { VitrinaModule } from './vitrina/vitrina.module';
import { PlanesModule } from './planes/planes.module';
import { EstructuraModule } from './estructura/estructura.module';
import { EmailModule } from './email/email.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envValidationSchema }),
    ScheduleModule.forRoot(),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): Params => {
        const isProd = config.get('NODE_ENV') === 'production';
        const lokiHost = config.get<string>('LOKI_HOST');
        const targets: TransportTargetOptions[] = [];

        if (!isProd) {
          targets.push({
            target: 'pino-pretty',
            level: 'debug',
            options: {
              colorize: true,
              singleLine: true,
              levelFirst: true,
              translateTime: 'HH:MM:ss',
              ignore: 'pid,hostname,name,context',
              // pino-pretty runs in a worker thread, so messageFormat must be a
              // serializable string — a function here silently fails to send.
              messageFormat: '[{name}] [{context}] {msg}',
            },
          });
        }

        // LOKI_HOST unset (e.g. Loki not running locally) means logs just
        // print to console — shipping is skipped, nothing throws.
        if (lokiHost) {
          targets.push({
            target: 'pino-loki',
            level: 'info',
            options: {
              host: lokiHost,
              basicAuth:
                config.get('LOKI_USER') && config.get('LOKI_PASSWORD')
                  ? { username: config.get('LOKI_USER'), password: config.get('LOKI_PASSWORD') }
                  : undefined,
              labels: { app: 'bolt-procure-backend', env: config.get('NODE_ENV', 'development') },
              batching: true,
              interval: 5,
            },
          });
        }

        return {
          pinoHttp: {
            name: 'bolt-procure-backend',
            level: isProd ? 'info' : 'debug',
            transport: targets.length ? { targets } : undefined,
            autoLogging: true,
            redact: {
              paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
              remove: true,
            },
            // Auto-logged request/response lines don't get a `context` from
            // Nest's Logger, so we set one here — keeps every console line
            // (app logs and HTTP logs alike) showing "[service] [context]".
            customProps: (req: IncomingMessage & { user?: { id?: string; email?: string; portal?: string } }) => ({
              context: 'HTTP',
              userId: req.user?.id,
              userEmail: req.user?.email,
              portal: req.user?.portal,
            }),
            customSuccessMessage: (req: IncomingMessage, res: ServerResponse) =>
              `${req.method} ${req.url} ${res.statusCode}`,
            customErrorMessage: (req: IncomingMessage, res: ServerResponse, err: Error) =>
              `${req.method} ${req.url} ${res.statusCode} — ${err.message}`,
          },
        };
      },
    }),
    RedisModule,
    // Tracked by IP and runs before auth so abusive traffic is rejected
    // before we spend a Supabase round-trip verifying its token. Individual
    // routes (e.g. registro-proveedor) can tighten this with @Throttle().
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, REDIS_CLIENT],
      useFactory: (config: ConfigService, redis: Redis) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),
    PrismaModule,
    SupabaseModule,
    StorageModule,
    HealthModule,
    AuthModule,
    UsuariosModule,
    RequerimientosModule,
    AprobacionesModule,
    MatrizAprobacionModule,
    ProveedoresModule,
    HomologacionModule,
    OfertasModule,
    AdjudicacionModule,
    ContratosModule,
    SeguimientoModule,
    DisputasModule,
    InvitacionesModule,
    PagosModule,
    NotificacionesModule,
    AuditLogModule,
    SubastaModule,
    InternoModule,
    PreguntasModule,
    VencimientosModule,
    AnaliticaModule,
    EvaluacionesModule,
    VitrinaModule,
    PlanesModule,
    EstructuraModule,
    EmailModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PortalGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
