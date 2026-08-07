import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SubastaService } from './subasta.service';

@ApiTags('subasta')
@Controller('subasta')
export class SubastaController {
  constructor(private service: SubastaService) {}

  @Get(':requerimientoId')
  getState(@Param('requerimientoId') requerimientoId: string) {
    return this.service.getState(requerimientoId);
  }
}
