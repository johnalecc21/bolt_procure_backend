import { Module } from '@nestjs/common';
import { EstructuraModule } from '../estructura/estructura.module';
import { ProveedoresModule } from '../proveedores/proveedores.module';
import { AnaliticaService } from './analitica.service';
import { AnaliticaController } from './analitica.controller';
import { AnaliticaProveedorService } from './analitica-proveedor.service';
import { AnaliticaProveedorController } from './analitica-proveedor.controller';

@Module({
  imports: [EstructuraModule, ProveedoresModule],
  // The supplier controller is registered first so /analitica/proveedor is
  // never shadowed by a parameterized cliente route.
  controllers: [AnaliticaProveedorController, AnaliticaController],
  providers: [AnaliticaService, AnaliticaProveedorService],
})
export class AnaliticaModule {}
