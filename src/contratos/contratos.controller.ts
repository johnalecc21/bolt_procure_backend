import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ContratosService } from './contratos.service';
import { UploadUrlDto } from './dto/upload-url.dto';
import { AdjuntarArchivoDto } from './dto/adjuntar-archivo.dto';
import { EmitirPoDto } from './dto/emitir-po.dto';
import {
  CambiarMontoDto,
  ProrrogarDto,
  ReportarAvanceDto,
  TerminarDto,
} from './dto/modificar-contrato.dto';
import { ListarContratosDto } from './dto/listar-contratos.dto';
import type { AuthenticatedUser } from '../auth/types';

/** Day-to-day contract management (POs, extensions, documents). */
const GESTIONAN = [Role.COMPRADOR, Role.ADMIN_CLIENTE];
/** Changing the value or ending a contract is a financial decision. */
const DECIDEN = [Role.ADMIN_CLIENTE, Role.APROBADOR_CFO];

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

  @PortalOnly('PROVEEDOR')
  @Post('mine/:id/hitos/:hitoId/avance')
  reportarAvance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('hitoId') hitoId: string,
    @Body() dto: ReportarAvanceDto,
  ) {
    return this.service.reportarAvance(user.sub, id, hitoId, dto.nota);
  }

  @PortalOnly('CLIENTE')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.companyId);
  }

  @PortalOnly('CLIENTE')
  @Get('pagina')
  listPaginada(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: ListarContratosDto,
  ) {
    return this.service.listPaginada(user.companyId, {
      page: dto.page ?? 1,
      limit: dto.limit ?? 20,
      q: dto.q,
      categoria: dto.categoria,
      estado: dto.estado,
    });
  }

  @PortalOnly('CLIENTE')
  @Get('categorias')
  categorias(@CurrentUser() user: AuthenticatedUser) {
    return this.service.categorias(user.companyId);
  }

  @PortalOnly('CLIENTE')
  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id);
  }

  @PortalOnly('CLIENTE')
  @Roles(...GESTIONAN)
  @Post(':id/upload-url')
  crearUrlSubida(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UploadUrlDto,
  ) {
    return this.service.crearUrlSubida(
      user.companyId,
      id,
      dto.filename,
      dto.tamanoBytes,
    );
  }

  @PortalOnly('CLIENTE')
  @Roles(...GESTIONAN)
  @Post(':id/adjuntar')
  adjuntar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdjuntarArchivoDto,
  ) {
    return this.service.adjuntarArchivo(
      user.companyId,
      id,
      dto.path,
      dto.nombre,
      user.email,
      dto.tamanoBytes,
    );
  }

  @PortalOnly('CLIENTE')
  @Get(':id/versiones/:versionId/url')
  urlVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Query('editable') editable?: string,
  ) {
    return this.service.urlVersion(
      user.companyId,
      id,
      versionId,
      editable === '1' || editable === 'true',
    );
  }

  @PortalOnly('CLIENTE')
  @Roles(...GESTIONAN)
  @Post(':id/documento/regenerar')
  regenerarDocumento(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.service.regenerarDocumento(user.companyId, id, user.email);
  }

  @PortalOnly('CLIENTE')
  @Roles(...GESTIONAN)
  @Post(':id/emitir-po')
  emitirPo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: EmitirPoDto,
  ) {
    return this.service.emitirPo(user.companyId, id, dto, user.email);
  }

  @PortalOnly('CLIENTE')
  @Roles(...GESTIONAN)
  @Post(':id/prorrogar')
  prorrogar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ProrrogarDto,
  ) {
    return this.service.prorrogar(user.companyId, id, dto, user.email);
  }

  @PortalOnly('CLIENTE')
  @Roles(...DECIDEN)
  @Post(':id/monto')
  cambiarMonto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CambiarMontoDto,
  ) {
    return this.service.cambiarMonto(user.companyId, id, dto, user.email);
  }

  @PortalOnly('CLIENTE')
  @Roles(...DECIDEN)
  @Post(':id/terminar')
  terminar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: TerminarDto,
  ) {
    return this.service.terminar(user.companyId, id, dto, user.email);
  }

  // No @PortalOnly: cliente can fetch a link for any contrato in their company,
  // proveedor only for their own — the service enforces which.
  @Get(':id/archivo-url')
  crearUrlDescarga(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.service.crearUrlDescarga(
      user.portal,
      user.portal === 'PROVEEDOR' ? user.sub : user.companyId,
      id,
    );
  }
}
