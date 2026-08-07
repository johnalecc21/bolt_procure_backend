import { Module } from '@nestjs/common';
import { HomologacionService } from './homologacion.service';
import { HomologacionController } from './homologacion.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { OcrService } from './ocr.service';
import { OfacService } from './ofac.service';

@Module({
  imports: [AuditLogModule],
  controllers: [HomologacionController],
  providers: [HomologacionService, OcrService, OfacService],
})
export class HomologacionModule {}
