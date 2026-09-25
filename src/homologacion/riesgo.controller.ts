import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EstadoAlertaRiesgo, Role } from '@prisma/client';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { ProveedoresService } from '../proveedores/proveedores.service';
import { RiesgoService } from './riesgo.service';

class ListarAlertasDto {
  @IsOptional()
  @IsIn(['ABIERTA', 'RESUELTA'])
  estado?: EstadoAlertaRiesgo;
}

class ResolverAlertaDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  resolucion: string;
}

@ApiTags('riesgo')
@Controller('riesgo')
export class RiesgoController {
  constructor(
    private service: RiesgoService,
    private proveedores: ProveedoresService,
  ) {}

  @PortalOnly('INTERNO')
  @Roles(Role.COMPLIANCE_OPS)
  @Get('alertas')
  alertas(@Query() dto: ListarAlertasDto) {
    return this.service.listar(dto.estado);
  }

  @PortalOnly('INTERNO')
  @Roles(Role.COMPLIANCE_OPS)
  @Post('alertas/:id/resolver')
  resolver(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ResolverAlertaDto,
  ) {
    return this.service.resolver(id, dto.resolucion, user.email);
  }

  /** Runs today's monitoring now (documents, lists, re-evaluations). */
  @PortalOnly('INTERNO')
  @Roles(Role.COMPLIANCE_OPS)
  @Post('ejecutar')
  ejecutar() {
    return this.service.ejecutar();
  }

  @PortalOnly('CLIENTE')
  @Get('proveedores/:id')
  proveedor(@Param('id') id: string) {
    return this.service.resumenProveedor(id);
  }

  @PortalOnly('PROVEEDOR')
  @Get('mias')
  async mias(@CurrentUser() user: AuthenticatedUser) {
    return this.service.mias(await this.proveedores.findIdForUser(user.sub));
  }
}
