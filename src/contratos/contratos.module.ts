import { Module } from '@nestjs/common';
import { ContratosService } from './contratos.service';
import { ContratosController } from './contratos.controller';

@Module({
  controllers: [ContratosController],
  providers: [ContratosService],
})
export class ContratosModule {}
