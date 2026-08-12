import { Module } from '@nestjs/common';
import { AprobacionesService } from './aprobaciones.service';
import { AprobacionesController } from './aprobaciones.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { RequerimientosModule } from '../requerimientos/requerimientos.module';

@Module({
  imports: [AuditLogModule, NotificacionesModule, RequerimientosModule],
  controllers: [AprobacionesController],
  providers: [AprobacionesService],
})
export class AprobacionesModule {}
