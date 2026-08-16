import { Module } from '@nestjs/common';
import { PreguntasService } from './preguntas.service';
import { PreguntasController } from './preguntas.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { ProveedoresModule } from '../proveedores/proveedores.module';

@Module({
  imports: [AuditLogModule, NotificacionesModule, ProveedoresModule],
  controllers: [PreguntasController],
  providers: [PreguntasService],
})
export class PreguntasModule {}
