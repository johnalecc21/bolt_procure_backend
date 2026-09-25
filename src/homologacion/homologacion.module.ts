import { Module } from '@nestjs/common';
import { HomologacionService } from './homologacion.service';
import { HomologacionScoringService } from './homologacion-scoring.service';
import { HomologacionController } from './homologacion.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { ProveedoresModule } from '../proveedores/proveedores.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { OcrService } from './ocr.service';
import { OfacService } from './ofac.service';
import { OnuService } from './onu.service';
import { ListasRestrictivasService } from './listas-restrictivas.service';
import { RiesgoService } from './riesgo.service';
import { RiesgoController } from './riesgo.controller';

@Module({
  imports: [AuditLogModule, ProveedoresModule, NotificacionesModule],
  controllers: [HomologacionController, RiesgoController],
  providers: [HomologacionService, HomologacionScoringService, OcrService, OfacService, OnuService, ListasRestrictivasService, RiesgoService],
})
export class HomologacionModule {}
