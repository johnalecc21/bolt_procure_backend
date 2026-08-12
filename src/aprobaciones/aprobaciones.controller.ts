import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AprobacionesService } from './aprobaciones.service';
import { RejectDto } from './dto/reject.dto';
import type { AuthenticatedUser } from '../auth/types';

// No @Roles gate here: who can act on a given aprobación is decided per-record
// by the Matriz de Aprobación (see AprobacionesService.esElegible), not by a
// fixed role list — a Comprador can legitimately own a low-amount approval.
@ApiTags('aprobaciones')
@PortalOnly('CLIENTE')
@Controller('aprobaciones')
export class AprobacionesController {
  constructor(private service: AprobacionesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.companyId, user.role);
  }

  @Post(':id/aprobar')
  aprobar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.aprobar(user.companyId, id, user.sub, user.role, user.email);
  }

  @Post(':id/rechazar')
  rechazar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectDto,
  ) {
    return this.service.rechazar(user.companyId, id, user.sub, user.role, user.email, dto.motivo);
  }
}
