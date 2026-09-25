import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { PagosModule } from '../pagos/pagos.module';
import {
  ErpEntradaController,
  IntegracionesController,
} from './integraciones.controller';
import { IntegracionesService } from './integraciones.service';
import { ErpEnvioService } from './erp-envio.service';

@Module({
  imports: [AuditLogModule, PagosModule],
  controllers: [IntegracionesController, ErpEntradaController],
  providers: [IntegracionesService, ErpEnvioService],
})
export class IntegracionesModule {}
