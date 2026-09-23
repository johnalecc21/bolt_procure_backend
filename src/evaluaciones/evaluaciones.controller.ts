import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EvaluacionesService } from './evaluaciones.service';
import { CreateEvaluacionDto } from './dto/create-evaluacion.dto';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('evaluaciones')
@Controller('evaluaciones')
export class EvaluacionesController {
  constructor(private service: EvaluacionesService) {}

  @PortalOnly('CLIENTE')
  @Roles(Role.COMPRADOR, Role.ADMIN_CLIENTE)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEvaluacionDto,
  ) {
    return this.service.create(user.companyId, user.sub, user.email, dto);
  }

  @PortalOnly('PROVEEDOR')
  @Get('mias')
  mias(@CurrentUser() user: AuthenticatedUser) {
    return this.service.mias(user.sub);
  }

  @PortalOnly('CLIENTE')
  @Get('contrato/:contratoId')
  listByContrato(
    @CurrentUser() user: AuthenticatedUser,
    @Param('contratoId') contratoId: string,
  ) {
    return this.service.listByContrato(user.companyId, contratoId);
  }

  @PortalOnly('CLIENTE')
  @Get('proveedor/:proveedorId')
  resumenProveedor(
    @CurrentUser() user: AuthenticatedUser,
    @Param('proveedorId') proveedorId: string,
  ) {
    return this.service.resumenProveedor(user.companyId, proveedorId);
  }
}
