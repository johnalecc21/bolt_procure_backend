import { Module } from '@nestjs/common';
import { VencimientosService } from './vencimientos.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';

@Module({
  imports: [AuditLogModule, NotificacionesModule],
  providers: [VencimientosService],
})
export class VencimientosModule {}
