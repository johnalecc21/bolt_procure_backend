import { Module } from '@nestjs/common';
import { EstructuraModule } from '../estructura/estructura.module';
import { AnaliticaService } from './analitica.service';
import { AnaliticaController } from './analitica.controller';

@Module({
  imports: [EstructuraModule],
  controllers: [AnaliticaController],
  providers: [AnaliticaService],
})
export class AnaliticaModule {}
