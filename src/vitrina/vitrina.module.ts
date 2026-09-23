import { Module } from '@nestjs/common';
import { ProveedoresModule } from '../proveedores/proveedores.module';
import { VitrinaController } from './vitrina.controller';
import { VitrinaService } from './vitrina.service';

@Module({
  imports: [ProveedoresModule],
  controllers: [VitrinaController],
  providers: [VitrinaService],
})
export class VitrinaModule {}
