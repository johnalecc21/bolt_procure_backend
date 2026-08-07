import { Module } from '@nestjs/common';
import { MatrizAprobacionService } from './matriz-aprobacion.service';
import { MatrizAprobacionController } from './matriz-aprobacion.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [AuditLogModule],
  controllers: [MatrizAprobacionController],
  providers: [MatrizAprobacionService],
})
export class MatrizAprobacionModule {}
