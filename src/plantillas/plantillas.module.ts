import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { PlantillasController } from './plantillas.controller';
import { PlantillasService } from './plantillas.service';
import { PdfConversor } from './pdf.conversor';

@Module({
  imports: [AuditLogModule],
  controllers: [PlantillasController],
  providers: [PlantillasService, PdfConversor],
  exports: [PlantillasService],
})
export class PlantillasModule {}
