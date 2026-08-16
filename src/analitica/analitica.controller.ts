import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AnaliticaService } from './analitica.service';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('analitica')
@PortalOnly('CLIENTE')
@Roles(Role.APROBADOR_CFO, Role.ADMIN_CLIENTE)
@Controller('analitica')
export class AnaliticaController {
  constructor(private service: AnaliticaService) {}

  @Get()
  resumen(@CurrentUser() user: AuthenticatedUser) {
    return this.service.resumen(user.companyId);
  }
}
