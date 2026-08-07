import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { PortalGuard } from './common/guards/portal.guard';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
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
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PortalGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
