import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SeguimientoService } from './seguimiento.service';
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

  @Post('hitos/:id/confirmar-recepcion')
  confirmarRecepcion(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.confirmarRecepcion(user.companyId, id);
  }
}
