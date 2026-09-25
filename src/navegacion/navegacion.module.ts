import { Module } from '@nestjs/common';
import { ProveedoresModule } from '../proveedores/proveedores.module';
import { NavegacionController } from './navegacion.controller';
import { NavegacionService } from './navegacion.service';

@Module({
  imports: [ProveedoresModule],
  controllers: [NavegacionController],
  providers: [NavegacionService],
})
export class NavegacionModule {}
