import { PlantillasModule } from '../plantillas/plantillas.module';
import { Module } from '@nestjs/common';
import { ContratosService } from './contratos.service';
import { ContratosController } from './contratos.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { ProveedoresModule } from '../proveedores/proveedores.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { SeguimientoModule } from '../seguimiento/seguimiento.module';

@Module({
  imports: [
    AuditLogModule,
    ProveedoresModule,
    NotificacionesModule,
    SeguimientoModule,
    PlantillasModule,
  ],
  controllers: [ContratosController],
  providers: [ContratosService],
})
export class ContratosModule {}
