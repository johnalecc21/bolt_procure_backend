import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ProveedoresService } from './proveedores.service';
import { CreateExternoDto } from './dto/create-externo.dto';
import type { AuthenticatedUser } from '../auth/types';

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

  @PortalOnly('PROVEEDOR')
  @Get('mine')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.service.findByUserId(user.sub);
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
