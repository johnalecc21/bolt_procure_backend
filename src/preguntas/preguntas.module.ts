import { Module } from '@nestjs/common';
import { PreguntasService } from './preguntas.service';
import { PreguntasController } from './preguntas.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';

@Module({
  imports: [AuditLogModule, NotificacionesModule],
  controllers: [PreguntasController],
  providers: [PreguntasService],
})
export class PreguntasModule {}
