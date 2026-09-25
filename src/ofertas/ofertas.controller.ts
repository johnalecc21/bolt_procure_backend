import { Body, Controller, Get, Param, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { archivo } from '../plantillas/plantillas.controller';
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
  listByRequerimiento(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.service.listByRequerimiento(user.companyId, id);
  }

  @PortalOnly('PROVEEDOR')
  @Get('mine/:requerimientoId/carta')
  async carta(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requerimientoId') requerimientoId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return archivo(
      res,
      await this.service.cartaAdjudicacion(user.sub, requerimientoId),
    );
  }

  @PortalOnly('PROVEEDOR')
  @Get('mine/historial')
  miHistorial(@CurrentUser() user: AuthenticatedUser) {
    return this.service.miHistorial(user.sub);
  }

  @PortalOnly('PROVEEDOR')
  @Get('mine')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listMine(user.sub);
  }

  @PortalOnly('PROVEEDOR')
  @Get('mine/:requerimientoId')
  mine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requerimientoId') requerimientoId: string,
  ) {
    return this.service.mine(user.sub, requerimientoId);
  }

  @PortalOnly('PROVEEDOR')
  @Put()
  upsert(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertOfertaDto) {
    return this.service.upsert(user.sub, dto);
  }

  @PortalOnly('PROVEEDOR')
  @Post(':requerimientoId/enviar')
  enviar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requerimientoId') requerimientoId: string,
  ) {
    return this.service.enviar(user.sub, requerimientoId);
  }
}
