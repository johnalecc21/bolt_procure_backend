import { Module } from '@nestjs/common';
import { AdjudicacionService } from './adjudicacion.service';
import { AdjudicacionController } from './adjudicacion.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';

@Module({
  imports: [AuditLogModule, NotificacionesModule],
  controllers: [AdjudicacionController],
  providers: [AdjudicacionService],
})
export class AdjudicacionModule {}
