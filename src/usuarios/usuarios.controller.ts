import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UsuariosService } from './usuarios.service';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('usuarios')
@PortalOnly('CLIENTE')
@Roles(Role.ADMIN_CLIENTE)
@Controller('usuarios')
export class UsuariosController {
  constructor(private service: UsuariosService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listByCompany(user.companyId);
  }

  @Post('invitar')
  invite(@CurrentUser() user: AuthenticatedUser, @Body() dto: InviteUserDto) {
    return this.service.invite(user.companyId, dto, user.email);
  }

  @Patch(':id/rol')
  updateRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') userId: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.service.updateRole(user.companyId, userId, dto.role, user.email);
  }

  @Patch(':id/estado')
  toggleActive(@CurrentUser() user: AuthenticatedUser, @Param('id') userId: string) {
    return this.service.toggleActive(user.companyId, userId, user.email);
  }
}
