import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdjudicacionService } from './adjudicacion.service';
import { CreateAdjudicacionDto } from './dto/create-adjudicacion.dto';
import { FirmarAdjudicacionDto } from './dto/firmar-adjudicacion.dto';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('adjudicacion')
@PortalOnly('CLIENTE')
@Controller('adjudicacion')
export class AdjudicacionController {
  constructor(private service: AdjudicacionService) {}

  @Get(':requerimientoId')
  findOne(@Param('requerimientoId') requerimientoId: string) {
    return this.service.findByRequerimiento(requerimientoId);
  }

  @Roles(Role.COMPRADOR, Role.ADMIN_CLIENTE)
  @Post()
  create(@Body() dto: CreateAdjudicacionDto) {
    return this.service.create(dto);
  }

  @Roles(Role.COMPRADOR, Role.ADMIN_CLIENTE, Role.APROBADOR_CFO)
  @Post(':requerimientoId/confirmar')
  confirmar(@CurrentUser() user: AuthenticatedUser, @Param('requerimientoId') requerimientoId: string) {
    return this.service.confirmar(requerimientoId, user.email);
  }

  @Roles(Role.COMPRADOR, Role.ADMIN_CLIENTE, Role.APROBADOR_CFO)
  @Post(':requerimientoId/revision-legal')
  revisionLegal(@CurrentUser() user: AuthenticatedUser, @Param('requerimientoId') requerimientoId: string) {
    return this.service.revisionLegal(requerimientoId, user.email);
  }

  @Roles(Role.COMPRADOR, Role.ADMIN_CLIENTE, Role.APROBADOR_CFO)
  @Post(':requerimientoId/firmar')
  firmar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requerimientoId') requerimientoId: string,
    @Body() dto: FirmarAdjudicacionDto,
  ) {
    return this.service.firmar(requerimientoId, user.email, dto.notificarPerdedores);
  }
}
