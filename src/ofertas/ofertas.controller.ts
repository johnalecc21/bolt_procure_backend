import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OfertasService } from './ofertas.service';
import { UpsertOfertaDto } from './dto/upsert-oferta.dto';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('ofertas')
@Controller('ofertas')
export class OfertasController {
  constructor(private service: OfertasService) {}

  @PortalOnly('CLIENTE')
  @Get('requerimiento/:id')
  listByRequerimiento(@Param('id') id: string) {
    return this.service.listByRequerimiento(id);
  }

  @PortalOnly('PROVEEDOR')
  @Put()
  upsert(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertOfertaDto) {
    return this.service.upsert(user.sub, dto);
  }

  @PortalOnly('PROVEEDOR')
  @Post(':requerimientoId/enviar')
  enviar(@CurrentUser() user: AuthenticatedUser, @Param('requerimientoId') requerimientoId: string) {
    return this.service.enviar(user.sub, requerimientoId);
  }
}
