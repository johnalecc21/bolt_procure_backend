import { Module } from '@nestjs/common';
import { HomologacionService } from './homologacion.service';
import { HomologacionScoringService } from './homologacion-scoring.service';
import { HomologacionController } from './homologacion.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { ProveedoresModule } from '../proveedores/proveedores.module';
import { OcrService } from './ocr.service';
import { OfacService } from './ofac.service';

@Module({
  imports: [AuditLogModule, ProveedoresModule],
  controllers: [HomologacionController],
  providers: [HomologacionService, HomologacionScoringService, OcrService, OfacService],
})
export class HomologacionModule {}
