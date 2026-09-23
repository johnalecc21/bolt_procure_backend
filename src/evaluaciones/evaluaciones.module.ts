import { Module } from '@nestjs/common';
import { EvaluacionesService } from './evaluaciones.service';
import { EvaluacionesController } from './evaluaciones.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { ProveedoresModule } from '../proveedores/proveedores.module';

@Module({
  imports: [AuditLogModule, NotificacionesModule, ProveedoresModule],
  controllers: [EvaluacionesController],
  providers: [EvaluacionesService],
})
export class EvaluacionesModule {}
