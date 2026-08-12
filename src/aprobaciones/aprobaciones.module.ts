import { Module } from '@nestjs/common';
import { AprobacionesService } from './aprobaciones.service';
import { AprobacionesController } from './aprobaciones.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';

@Module({
  imports: [AuditLogModule, NotificacionesModule],
  controllers: [AprobacionesController],
  providers: [AprobacionesService],
})
export class AprobacionesModule {}
