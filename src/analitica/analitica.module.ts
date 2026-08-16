import { Module } from '@nestjs/common';
import { AnaliticaService } from './analitica.service';
import { AnaliticaController } from './analitica.controller';

@Module({
  controllers: [AnaliticaController],
  providers: [AnaliticaService],
})
export class AnaliticaModule {}
