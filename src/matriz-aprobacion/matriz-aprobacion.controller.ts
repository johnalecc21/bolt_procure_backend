import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MatrizAprobacionService } from './matriz-aprobacion.service';
import { UpsertReglasDto } from './dto/upsert-reglas.dto';
import { UpdateConfigDto } from './dto/update-config.dto';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('matriz-aprobacion')
@PortalOnly('CLIENTE')
@Roles(Role.ADMIN_CLIENTE)
@Controller('matriz-aprobacion')
export class MatrizAprobacionController {
  constructor(private service: MatrizAprobacionService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.companyId);
  }

  @Put()
  replace(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertReglasDto) {
    return this.service.replace(user.companyId, dto.reglas, user.email);
  }

  // Registered after '' so it doesn't collide with the bare list/replace routes.
  @Get('config')
  getConfig(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getConfig(user.companyId);
  }

  @Put('config')
  updateConfig(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateConfigDto) {
    return this.service.updateConfig(user.companyId, dto, user.email);
  }
}
