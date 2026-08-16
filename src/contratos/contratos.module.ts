import { Module } from '@nestjs/common';
import { ContratosService } from './contratos.service';
import { ContratosController } from './contratos.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { ProveedoresModule } from '../proveedores/proveedores.module';

@Module({
  imports: [AuditLogModule, ProveedoresModule],
  controllers: [ContratosController],
  providers: [ContratosService],
})
export class ContratosModule {}
