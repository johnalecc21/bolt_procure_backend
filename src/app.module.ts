import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import Redis from 'ioredis';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { SupabaseModule } from './supabase/supabase.module';
import { RedisModule } from './redis/redis.module';
import { REDIS_CLIENT } from './redis/redis.constants';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { PortalGuard } from './common/guards/portal.guard';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
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
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PortalGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
