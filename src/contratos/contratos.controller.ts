import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ContratosService } from './contratos.service';
import { UploadUrlDto } from './dto/upload-url.dto';
import { AdjuntarArchivoDto } from './dto/adjuntar-archivo.dto';
import { EmitirPoDto } from './dto/emitir-po.dto';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('contratos')
@Controller('contratos')
export class ContratosController {
  constructor(private service: ContratosService) {}

  // Registered before ':id' so "mine" isn't swallowed as a company-scoped contract id.
  @PortalOnly('PROVEEDOR')
  @Get('mine')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listMine(user.sub);
  }

  @PortalOnly('PROVEEDOR')
  @Get('mine/:id')
  findOneMine(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.findOneMine(user.sub, id);
  }

  @PortalOnly('CLIENTE')
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('categoria') categoria?: string,
    @Query('q') query?: string,
  ) {
    return this.service.list(user.companyId, { categoria, query });
  }

  @PortalOnly('CLIENTE')
  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id);
  }

  @PortalOnly('CLIENTE')
  @Post(':id/upload-url')
  crearUrlSubida(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UploadUrlDto) {
    return this.service.crearUrlSubida(user.companyId, id, dto.filename);
  }

  @PortalOnly('CLIENTE')
  @Post(':id/adjuntar')
  adjuntar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AdjuntarArchivoDto) {
    return this.service.adjuntarArchivo(user.companyId, id, dto.path, dto.nombre, user.email);
  }

  @PortalOnly('CLIENTE')
  @Post(':id/emitir-po')
  emitirPo(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: EmitirPoDto) {
    return this.service.emitirPo(user.companyId, id, dto, user.email);
  }

  // No @PortalOnly: cliente can fetch a link for any contrato in their company,
  // proveedor only for their own — the service enforces which.
  @Get(':id/archivo-url')
  crearUrlDescarga(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.crearUrlDescarga(user.portal, user.portal === 'PROVEEDOR' ? user.sub : user.companyId, id);
  }
}
