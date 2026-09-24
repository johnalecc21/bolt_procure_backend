import { Module } from '@nestjs/common';
import { PagosService } from './pagos.service';
import { CuentasPorPagarService } from './cuentas-por-pagar.service';
import { CuentasPorPagarController, PagosController } from './pagos.controller';
import { ProveedoresModule } from '../proveedores/proveedores.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';

@Module({
  imports: [ProveedoresModule, AuditLogModule, NotificacionesModule],
  controllers: [PagosController, CuentasPorPagarController],
  providers: [PagosService, CuentasPorPagarService],
})
export class PagosModule {}
