import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdjudicacionService } from './adjudicacion.service';
import { CreateAdjudicacionDto } from './dto/create-adjudicacion.dto';
import {
  AdjudicacionObjetivoDto,
  CartaAdjudicacionDto,
  FirmarAdjudicacionDto,
} from './dto/firmar-adjudicacion.dto';
import { PlantillasService } from '../plantillas/plantillas.service';
import { archivo } from '../plantillas/plantillas.controller';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('adjudicacion')
@PortalOnly('CLIENTE')
@Controller('adjudicacion')
export class AdjudicacionController {
  constructor(
    private service: AdjudicacionService,
    private plantillas: PlantillasService,
  ) {}

  /**
   * The award letter for one supplier, from the company's letter template
   * (Plantillas y documentos) or Procurex's default one.
   */
  @Get(':requerimientoId/carta')
  async carta(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requerimientoId') requerimientoId: string,
    @Query() dto: CartaAdjudicacionDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.plantillas.cartaAdjudicacion(
      user.companyId,
      requerimientoId,
      dto.adjudicacionId,
      dto.formato,
    );
    res.set('X-Plantilla', f.plantilla ? encodeURIComponent(f.plantilla) : '');
    return archivo(res, f);
  }

  @Get(':requerimientoId')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requerimientoId') requerimientoId: string,
  ) {
    return this.service.findByRequerimiento(user.companyId, requerimientoId);
  }

  @Roles(Role.COMPRADOR, Role.ADMIN_CLIENTE)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAdjudicacionDto,
  ) {
    return this.service.create(user.companyId, dto);
  }

  @Roles(Role.COMPRADOR, Role.ADMIN_CLIENTE, Role.APROBADOR_CFO)
  @Post(':requerimientoId/confirmar')
  confirmar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requerimientoId') requerimientoId: string,
  ) {
    return this.service.confirmar(user.companyId, requerimientoId, user.email);
  }

  @Roles(Role.COMPRADOR, Role.ADMIN_CLIENTE, Role.APROBADOR_CFO)
  @Post(':requerimientoId/revision-legal')
  revisionLegal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requerimientoId') requerimientoId: string,
    @Body() dto: AdjudicacionObjetivoDto,
  ) {
    return this.service.revisionLegal(
      user.companyId,
      requerimientoId,
      user.email,
      dto.adjudicacionId,
    );
  }

  @Roles(Role.COMPRADOR, Role.ADMIN_CLIENTE, Role.APROBADOR_CFO)
  @Post(':requerimientoId/firmar')
  firmar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requerimientoId') requerimientoId: string,
    @Body() dto: FirmarAdjudicacionDto,
  ) {
    return this.service.firmar(
      user.companyId,
      requerimientoId,
      user.email,
      dto.notificarPerdedores,
      dto.adjudicacionId,
    );
  }
}
