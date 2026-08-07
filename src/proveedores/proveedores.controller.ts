import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ProveedoresService } from './proveedores.service';
import { CreateExternoDto } from './dto/create-externo.dto';

@ApiTags('proveedores')
@Controller('proveedores')
export class ProveedoresController {
  constructor(private service: ProveedoresService) {}

  @Get()
  list(
    @Query('categoria') categoria?: string,
    @Query('minScore') minScore?: string,
    @Query('q') query?: string,
  ) {
    return this.service.list({
      categoria,
      minScore: minScore ? Number(minScore) : undefined,
      query,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post('externo')
  createExterno(@Body() dto: CreateExternoDto) {
    return this.service.createExterno(dto.nombre);
  }
}
