import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ProveedoresService } from './proveedores.service';
import { CreateExternoDto } from './dto/create-externo.dto';
import { UpdatePerfilDto } from './dto/update-perfil.dto';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('proveedores')
@Controller('proveedores')
export class ProveedoresController {
  constructor(private service: ProveedoresService) {}

  @PortalOnly('CLIENTE', 'INTERNO')
  @Get()
  list(
    @Query('categoria') categoria?: string,
    @Query('minScore') minScore?: string,
    @Query('q') query?: string,
  ) {
    return this.service.list({
      categoria,
      minScore: minScore ? Number(minScore) : undefined,
      query,
    });
  }

  @PortalOnly('PROVEEDOR')
  @Get('mine')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.service.findByUserId(user.sub);
  }

  @PortalOnly('PROVEEDOR')
  @Patch('mine')
  actualizarMiPerfil(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdatePerfilDto) {
    return this.service.actualizarMiPerfil(user.sub, dto);
  }

  @PortalOnly('PROVEEDOR')
  @Post('mine/onboarding/completar')
  completarOnboarding(@CurrentUser() user: AuthenticatedUser) {
    return this.service.completarOnboarding(user.sub);
  }

  @PortalOnly('CLIENTE', 'INTERNO')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @PortalOnly('CLIENTE')
  @Roles(Role.COMPRADOR, Role.ADMIN_CLIENTE)
  @Post('externo')
  createExterno(@Body() dto: CreateExternoDto) {
    return this.service.createExterno(dto.nombre);
  }
}
