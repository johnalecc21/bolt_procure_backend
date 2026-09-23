import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { PlanesService } from './planes.service';

@ApiTags('empresa')
@PortalOnly('CLIENTE')
@Controller('empresa')
export class PlanesController {
  constructor(private service: PlanesService) {}

  /** Current plan, its limits and this month's usage. */
  @Roles(Role.ADMIN_CLIENTE, Role.APROBADOR_CFO)
  @Get('uso')
  uso(@CurrentUser() user: AuthenticatedUser) {
    return this.service.uso(user.companyId);
  }
}
