import { Module } from '@nestjs/common';
import { HomologacionService } from './homologacion.service';
import { HomologacionController } from './homologacion.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [AuditLogModule],
  controllers: [HomologacionController],
  providers: [HomologacionService],
})
export class HomologacionModule {}
