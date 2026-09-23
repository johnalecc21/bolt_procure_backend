import { Module } from '@nestjs/common';
import { RequerimientosService } from './requerimientos.service';
import { RequerimientosController } from './requerimientos.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { EstructuraModule } from '../estructura/estructura.module';

@Module({
  imports: [AuditLogModule, NotificacionesModule, EstructuraModule],
  controllers: [RequerimientosController],
  providers: [RequerimientosService],
  exports: [RequerimientosService],
})
export class RequerimientosModule {}
