import { Module } from '@nestjs/common';
import { DisputasService } from './disputas.service';
import { DisputasController } from './disputas.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [AuditLogModule],
  controllers: [DisputasController],
  providers: [DisputasService],
})
export class DisputasModule {}
