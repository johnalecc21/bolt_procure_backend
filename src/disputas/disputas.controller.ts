import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DisputasService } from './disputas.service';
import { CreateDisputaDto } from './dto/create-disputa.dto';
import { AddMensajeDto } from './dto/add-mensaje.dto';
import { ResolverDisputaDto } from './dto/resolver-disputa.dto';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('disputas')
@Controller('disputas')
export class DisputasController {
  constructor(private service: DisputasService) {}

  @PortalOnly('CLIENTE')
  @Roles(Role.COMPRADOR, Role.ADMIN_CLIENTE)
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.companyId);
  }

  @PortalOnly('CLIENTE')
  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id);
  }

  @PortalOnly('CLIENTE')
  @Roles(Role.COMPRADOR, Role.ADMIN_CLIENTE)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDisputaDto) {
    return this.service.create(user.companyId, dto, user.email, user.sub);
  }

  @PortalOnly('CLIENTE')
  @Post(':id/mensajes')
  addMensaje(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddMensajeDto,
  ) {
    return this.service.addMensaje(user.companyId, id, user.email, user.sub, dto.texto);
  }

  @PortalOnly('INTERNO')
  @Roles(Role.COMPLIANCE_OPS)
  @Get('interno/todas')
  listAll() {
    return this.service.listAll();
  }

  @PortalOnly('INTERNO')
  @Roles(Role.COMPLIANCE_OPS)
  @Post(':id/asignar')
  asignar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.asignarMediador(id, user.sub);
  }

  @PortalOnly('INTERNO')
  @Roles(Role.COMPLIANCE_OPS)
  @Post(':id/resolver')
  resolver(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ResolverDisputaDto,
  ) {
    return this.service.resolver(id, dto.decision, dto.impacto, user.email);
  }
}
