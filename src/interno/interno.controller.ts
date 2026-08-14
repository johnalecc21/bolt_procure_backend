import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { InternoService } from './interno.service';
import { ImpersonarDto } from './dto/impersonar.dto';
import { CrearClienteDto } from './dto/crear-cliente.dto';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('interno')
@PortalOnly('INTERNO')
@Controller('interno')
export class InternoController {
  constructor(private service: InternoService) {}

  @Get('casos')
  listCasos(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listCasos(user.sub);
  }

  @Roles(Role.COMPLIANCE_OPS)
  @Get('clientes')
  listClientes() {
    return this.service.listClientes();
  }

  @Roles(Role.COMPLIANCE_OPS)
  @Post('clientes')
  crearCliente(@CurrentUser() user: AuthenticatedUser, @Body() dto: CrearClienteDto) {
    return this.service.crearCliente(dto, user.sub, user.email);
  }

  @Roles(Role.COMPLIANCE_OPS)
  @Post('clientes/:id/impersonar')
  impersonar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ImpersonarDto,
  ) {
    return this.service.impersonar(id, user.sub, user.email, dto.motivo);
  }

  @Get('benchmark')
  listBenchmark() {
    return this.service.listBenchmark();
  }

  @Post('benchmark/:id/marcar-valido')
  marcarValido(@Param('id') id: string) {
    return this.service.marcarValido(id);
  }
}
