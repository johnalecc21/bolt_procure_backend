import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { EstructuraController } from './estructura.controller';
import { EstructuraService } from './estructura.service';

@Module({
  imports: [AuditLogModule],
  controllers: [EstructuraController],
  providers: [EstructuraService],
  exports: [EstructuraService],
})
export class EstructuraModule {}
