import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SeguimientoService } from './seguimiento.service';
import { CreateHitoDto } from './dto/create-hito.dto';
import { UpdateHitoDto } from './dto/update-hito.dto';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('seguimiento')
@PortalOnly('CLIENTE')
@Roles(Role.COMPRADOR, Role.ADMIN_CLIENTE)
@Controller('seguimiento')
export class SeguimientoController {
  constructor(private service: SeguimientoService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.companyId);
  }

  @Post('contratos/:contratoId/hitos')
  crearHito(
    @CurrentUser() user: AuthenticatedUser,
    @Param('contratoId') contratoId: string,
    @Body() dto: CreateHitoDto,
  ) {
    return this.service.crearHito(user.companyId, contratoId, dto);
  }

  @Patch('hitos/:id')
  actualizarHito(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateHitoDto,
  ) {
    return this.service.actualizarHito(user.companyId, id, dto);
  }

  @Delete('hitos/:id')
  eliminarHito(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.eliminarHito(user.companyId, id);
  }
}
