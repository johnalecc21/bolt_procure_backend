import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { EstructuraService } from './estructura.service';
import {
  AnioParam,
  CentroCostoDto,
  ConfigEstructuraDto,
  PresupuestoDto,
  UnidadNegocioDto,
} from './dto/estructura.dto';

@ApiTags('estructura')
@PortalOnly('CLIENTE')
@Controller('estructura')
export class EstructuraController {
  constructor(private service: EstructuraService) {}

  /** Every client role needs the list to pick a centro de costo when creating a requerimiento. */
  @Get()
  listar(@CurrentUser() user: AuthenticatedUser, @Query('anio') anio?: string) {
    return this.service.listar(user.companyId, anio ? Number(anio) : undefined);
  }

  @Roles(Role.ADMIN_CLIENTE, Role.APROBADOR_CFO)
  @Get('ejecucion')
  ejecucion(
    @CurrentUser() user: AuthenticatedUser,
    @Query() { anio }: AnioParam,
  ) {
    return this.service.ejecucion(user.companyId, anio);
  }

  @Roles(Role.ADMIN_CLIENTE)
  @Put('config')
  config(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfigEstructuraDto,
  ) {
    return this.service.actualizarConfig(
      user.companyId,
      dto.exigeCentroCosto,
      user.email,
    );
  }

  @Roles(Role.ADMIN_CLIENTE)
  @Post('unidades')
  crearUnidad(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UnidadNegocioDto,
  ) {
    return this.service.crearUnidad(user.companyId, dto, user.email);
  }

  @Roles(Role.ADMIN_CLIENTE)
  @Patch('unidades/:id')
  actualizarUnidad(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UnidadNegocioDto,
  ) {
    return this.service.actualizarUnidad(user.companyId, id, dto, user.email);
  }

  @Roles(Role.ADMIN_CLIENTE)
  @Post('centros')
  crearCentro(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CentroCostoDto,
  ) {
    return this.service.crearCentro(user.companyId, dto, user.email);
  }

  @Roles(Role.ADMIN_CLIENTE)
  @Patch('centros/:id')
  actualizarCentro(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CentroCostoDto,
  ) {
    return this.service.actualizarCentro(user.companyId, id, dto, user.email);
  }

  /** Budgets are set by the CFO as well as the admin — it's their number. */
  @Roles(Role.ADMIN_CLIENTE, Role.APROBADOR_CFO)
  @Put('centros/:id/presupuestos/:anio')
  fijarPresupuesto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param() { anio }: AnioParam,
    @Body() dto: PresupuestoDto,
  ) {
    return this.service.fijarPresupuesto(
      user.companyId,
      id,
      anio,
      dto.monto,
      dto.moneda,
      user.email,
    );
  }
}
