import { Module } from '@nestjs/common';
import { SubastaService } from './subasta.service';
import { SubastaGateway } from './subasta.gateway';
import { SubastaController } from './subasta.controller';
import { ProveedoresModule } from '../proveedores/proveedores.module';

@Module({
  imports: [ProveedoresModule],
  controllers: [SubastaController],
  providers: [SubastaService, SubastaGateway],
})
export class SubastaModule {}
