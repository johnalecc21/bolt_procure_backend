import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { InvitacionesService } from './invitaciones.service';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('invitaciones')
@PortalOnly('PROVEEDOR')
@Controller('invitaciones')
export class InvitacionesController {
  constructor(private service: InvitacionesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listMine(user.sub);
  }

  @Post(':id/aceptar')
  aceptar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.responder(user.sub, id, 'VISTA');
  }

  @Post(':id/declinar')
  declinar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.responder(user.sub, id, 'DECLINADA');
  }
}
