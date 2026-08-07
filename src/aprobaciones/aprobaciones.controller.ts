import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AprobacionesService } from './aprobaciones.service';
import { RejectDto } from './dto/reject.dto';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('aprobaciones')
@PortalOnly('CLIENTE')
@Roles(Role.APROBADOR_CFO, Role.ADMIN_CLIENTE)
@Controller('aprobaciones')
export class AprobacionesController {
  constructor(private service: AprobacionesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.companyId);
  }

  @Post(':id/aprobar')
  aprobar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.aprobar(user.companyId, id, user.sub, user.email);
  }

  @Post(':id/rechazar')
  rechazar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectDto,
  ) {
    return this.service.rechazar(user.companyId, id, user.sub, user.email, dto.motivo);
  }
}
