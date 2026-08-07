import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { HomologacionService } from './homologacion.service';
import { ResolverDto } from './dto/resolver.dto';
import { UploadUrlDto } from './dto/upload-url.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('homologacion')
@Controller('homologacion')
export class HomologacionController {
  constructor(private service: HomologacionService) {}

  @PortalOnly('PROVEEDOR')
  @Get('mine')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.service.mine(user.sub);
  }

  @PortalOnly('PROVEEDOR')
  @Post('documentos/:id/upload-url')
  crearUrlSubida(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UploadUrlDto,
  ) {
    return this.service.crearUrlSubida(user.sub, id, dto.filename);
  }

  @PortalOnly('PROVEEDOR')
  @Post('documentos/:id/subir')
  subir(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ConfirmUploadDto,
  ) {
    return this.service.subirDocumento(user.sub, id, dto.path);
  }

  @Get('documentos/:id/download-url')
  crearUrlDescarga(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.crearUrlDescarga(user.sub, user.portal, user.role, id);
  }

  @PortalOnly('PROVEEDOR')
  @Post('enviar')
  enviar(@CurrentUser() user: AuthenticatedUser) {
    return this.service.enviar(user.sub);
  }

  @PortalOnly('INTERNO')
  @Roles(Role.COMPLIANCE_OPS)
  @Get('cola')
  cola() {
    return this.service.cola();
  }

  @PortalOnly('INTERNO')
  @Roles(Role.COMPLIANCE_OPS)
  @Post(':proveedorId/resolver')
  resolver(
    @CurrentUser() user: AuthenticatedUser,
    @Param('proveedorId') proveedorId: string,
    @Body() dto: ResolverDto,
  ) {
    return this.service.resolver(proveedorId, dto.estado, dto.score, user.email, dto.motivo);
  }
}
