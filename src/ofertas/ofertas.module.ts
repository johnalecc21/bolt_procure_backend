import { Module } from '@nestjs/common';
import { OfertasService } from './ofertas.service';
import { OfertasController } from './ofertas.controller';
import { ProveedoresModule } from '../proveedores/proveedores.module';
import { PlantillasModule } from '../plantillas/plantillas.module';

@Module({
  imports: [ProveedoresModule, PlantillasModule],
  controllers: [OfertasController],
  providers: [OfertasService],
})
export class OfertasModule {}
