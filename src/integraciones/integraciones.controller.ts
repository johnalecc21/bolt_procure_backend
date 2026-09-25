import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { IntegracionesService } from './integraciones.service';
import {
  AcuseDto,
  ActualizarIntegracionDto,
  GuardarMapeosDto,
  IdsDto,
  ListarEventosDto,
  PagoEntranteDto,
  RangoDto,
} from './dto/integraciones.dto';

/** Integration settings and exports: finance decisions. */
const FINANZAS = [Role.ADMIN_CLIENTE, Role.APROBADOR_CFO];

@ApiTags('integraciones')
@PortalOnly('CLIENTE')
@Controller('integraciones')
export class IntegracionesController {
  constructor(private service: IntegracionesService) {}

  @Roles(...FINANZAS)
  @Get('erp')
  obtener(@CurrentUser() user: AuthenticatedUser) {
    return this.service.obtener(user.companyId);
  }

  @Roles(...FINANZAS)
  @Patch('erp')
  actualizar(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ActualizarIntegracionDto,
  ) {
    return this.service.actualizar(user.companyId, dto, user.email);
  }

  @Roles(...FINANZAS)
  @Post('erp/secreto')
  secreto(@CurrentUser() user: AuthenticatedUser) {
    return this.service.generarSecreto(user.companyId, user.email);
  }

  @Roles(...FINANZAS)
  @Post('erp/api-key')
  apiKey(@CurrentUser() user: AuthenticatedUser) {
    return this.service.generarApiKey(user.companyId, user.email);
  }

  @Roles(...FINANZAS)
  @Post('erp/probar')
  probar(@CurrentUser() user: AuthenticatedUser) {
    return this.service.probar(user.companyId);
  }

  @Roles(...FINANZAS)
  @Get('erp/siigo/catalogos')
  catalogosSiigo(@CurrentUser() user: AuthenticatedUser) {
    return this.service.catalogosSiigo(user.companyId);
  }

  @Roles(...FINANZAS)
  @Post('erp/siigo/sincronizar-pagos')
  sincronizarPagosSiigo(@CurrentUser() user: AuthenticatedUser) {
    return this.service.sincronizarPagosSiigo(user.companyId, user.email);
  }

  @Roles(...FINANZAS)
  @Get('erp/eventos')
  eventos(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: ListarEventosDto,
  ) {
    return this.service.listarEventos(user.companyId, dto);
  }

  @Roles(...FINANZAS)
  @Get('erp/eventos/pendientes')
  pendientes(@CurrentUser() user: AuthenticatedUser) {
    return this.service.pendientes(user.companyId);
  }

  @Roles(...FINANZAS)
  @Post('erp/eventos/exportados')
  exportados(@CurrentUser() user: AuthenticatedUser, @Body() dto: IdsDto) {
    return this.service.marcarExportados(user.companyId, dto.ids, user.email);
  }

  @Roles(...FINANZAS)
  @Get('erp/eventos/:id')
  verEvento(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.verEvento(user.companyId, id);
  }

  @Roles(...FINANZAS)
  @Post('erp/eventos/:id/reintentar')
  reintentar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.reintentar(user.companyId, id);
  }

  @Roles(...FINANZAS)
  @Post('erp/eventos/:id/descartar')
  descartar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.descartar(user.companyId, id, user.email);
  }

  @Roles(...FINANZAS)
  @Get('erp/mapeos')
  mapeos(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listarMapeos(user.companyId);
  }

  @Roles(...FINANZAS)
  @Put('erp/mapeos')
  guardarMapeos(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GuardarMapeosDto,
  ) {
    return this.service.guardarMapeos(user.companyId, dto, user.email);
  }

  @Roles(...FINANZAS)
  @Get('erp/exportacion')
  exportar(@CurrentUser() user: AuthenticatedUser, @Query() dto: RangoDto) {
    return this.service.exportar(user.companyId, dto.desde, dto.hasta);
  }

  /** Sync badge on documents: any buyer can see whether it reached the ERP. */
  @Get('erp/estado')
  estado(@CurrentUser() user: AuthenticatedUser, @Query('ids') ids = '') {
    return this.service.estadoDocumentos(
      user.companyId,
      ids.split(',').filter(Boolean).slice(0, 200),
    );
  }
}

/**
 * Called by the company's ERP or middleware — not by a logged-in user. It
 * authenticates with the integration's API key (Authorization: Bearer … or
 * X-Api-Key), which also tells us the company.
 */
@ApiTags('integraciones')
@Public()
@Controller('integraciones/erp/entrada')
export class ErpEntradaController {
  constructor(private service: IntegracionesService) {}

  private key(auth?: string, xKey?: string) {
    return xKey ?? auth?.replace(/^Bearer\s+/i, '');
  }

  @Post('pagos')
  @HttpCode(200)
  async pago(
    @Headers('authorization') auth: string | undefined,
    @Headers('x-api-key') xKey: string | undefined,
    @Body() dto: PagoEntranteDto,
  ) {
    const companyId = await this.service.empresaPorApiKey(this.key(auth, xKey));
    return this.service.pagoEntrante(companyId, dto);
  }

  @Post('acuse')
  @HttpCode(200)
  async acuse(
    @Headers('authorization') auth: string | undefined,
    @Headers('x-api-key') xKey: string | undefined,
    @Body() dto: AcuseDto,
  ) {
    const companyId = await this.service.empresaPorApiKey(this.key(auth, xKey));
    return this.service.acuse(companyId, dto);
  }
}
