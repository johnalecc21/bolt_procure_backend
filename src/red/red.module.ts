import { Module } from '@nestjs/common';
import { ProveedoresModule } from '../proveedores/proveedores.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { RedController } from './red.controller';
import { RedService } from './red.service';

@Module({
  imports: [ProveedoresModule, NotificacionesModule, AuditLogModule],
  controllers: [RedController],
  providers: [RedService],
  exports: [RedService],
})
export class RedModule {}
