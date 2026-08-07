import { Module } from '@nestjs/common';
import { OfertasService } from './ofertas.service';
import { OfertasController } from './ofertas.controller';

@Module({
  controllers: [OfertasController],
  providers: [OfertasService],
})
export class OfertasModule {}
