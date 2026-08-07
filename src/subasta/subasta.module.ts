import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SubastaService } from './subasta.service';
import { SubastaGateway } from './subasta.gateway';
import { SubastaController } from './subasta.controller';

@Module({
  imports: [JwtModule.register({})],
  controllers: [SubastaController],
  providers: [SubastaService, SubastaGateway],
})
export class SubastaModule {}
