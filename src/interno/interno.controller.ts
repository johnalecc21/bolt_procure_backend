import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { InternoService } from './interno.service';
import { CrearClienteDto } from './dto/crear-cliente.dto';
import type { AuthenticatedUser } from '../auth/types';

/**
 * Procurex's own team: follows each client company as an account and adds
 * new ones. Homologation lives in /homologacion and /riesgo. Nothing here
 * reads or changes a company's purchase processes.
 */
@ApiTags('interno')
@PortalOnly('INTERNO')
@Roles(Role.COMPLIANCE_OPS, Role.CONSULTOR)
@Controller('interno')
export class InternoController {
  constructor(private service: InternoService) {}

  @Get('clientes')
  listClientes() {
    return this.service.listClientes();
  }

  @Get('clientes/:id')
  resumenCliente(@Param('id') id: string) {
    return this.service.resumenCliente(id);
  }

  @Roles(Role.COMPLIANCE_OPS)
  @Post('clientes')
  crearCliente(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CrearClienteDto,
  ) {
    return this.service.crearCliente(dto, user.sub, user.email);
  }
}
