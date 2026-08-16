import { Module } from '@nestjs/common';
import { PagosService } from './pagos.service';
import { PagosController } from './pagos.controller';
import { ProveedoresModule } from '../proveedores/proveedores.module';

@Module({
  imports: [ProveedoresModule],
  controllers: [PagosController],
  providers: [PagosService],
})
export class PagosModule {}
