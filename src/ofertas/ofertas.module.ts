import { Module } from '@nestjs/common';
import { OfertasService } from './ofertas.service';
import { OfertasController } from './ofertas.controller';
import { ProveedoresModule } from '../proveedores/proveedores.module';

@Module({
  imports: [ProveedoresModule],
  controllers: [OfertasController],
  providers: [OfertasService],
})
export class OfertasModule {}
