import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PagosService } from './pagos.service';
import { CuentasPorPagarService } from './cuentas-por-pagar.service';
import {
  MotivoDto,
  RadicarFacturaDto,
  RegistrarPagoDto,
  SolicitarProntoPagoDto,
  UploadArchivoDto,
} from './dto/pagos.dto';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('pagos')
@PortalOnly('PROVEEDOR')
@Controller('pagos')
export class PagosController {
  constructor(private service: PagosService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listMine(user.sub);
  }

  @Post(':id/factura/upload-url')
  urlSubida(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UploadArchivoDto,
  ) {
    return this.service.urlSubidaFactura(user.sub, id, dto.filename);
  }

  @Post(':id/factura')
  radicar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RadicarFacturaDto,
  ) {
    return this.service.radicarFactura(user.sub, id, dto, user.email);
  }

  @Get(':id/factura/:facturaId/url')
  urlFactura(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('facturaId') facturaId: string,
  ) {
    return this.service.urlDescargaFactura(user.sub, id, facturaId);
  }

  @Get(':id/soporte-url')
  urlSoporte(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.urlDescargaSoporte(user.sub, id);
  }

  @Post(':id/pronto-pago/simular')
  simular(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SolicitarProntoPagoDto,
  ) {
    return this.service.simularProntoPago(user.sub, id, dto.fechaPropuesta);
  }

  @Post(':id/pronto-pago')
  solicitar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SolicitarProntoPagoDto,
  ) {
    return this.service.solicitarProntoPago(
      user.sub,
      id,
      dto.fechaPropuesta,
      user.email,
    );
  }
}

/** Invoices are reviewed by purchasing or finance; money moves only with finance. */
const REVISAN = [Role.COMPRADOR, Role.ADMIN_CLIENTE, Role.APROBADOR_CFO];
const PAGAN = [Role.ADMIN_CLIENTE, Role.APROBADOR_CFO];

@ApiTags('cuentas-por-pagar')
@PortalOnly('CLIENTE')
@Controller('cuentas-por-pagar')
export class CuentasPorPagarController {
  constructor(private service: CuentasPorPagarService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.companyId);
  }

  @Get('facturas/:facturaId/url')
  urlFactura(
    @CurrentUser() user: AuthenticatedUser,
    @Param('facturaId') facturaId: string,
  ) {
    return this.service.urlDescargaFactura(user.companyId, facturaId);
  }

  @Roles(...REVISAN)
  @Post('facturas/:facturaId/aprobar')
  aprobar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('facturaId') facturaId: string,
  ) {
    return this.service.revisarFactura(
      user.companyId,
      facturaId,
      true,
      user.email,
    );
  }

  @Roles(...REVISAN)
  @Post('facturas/:facturaId/rechazar')
  rechazar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('facturaId') facturaId: string,
    @Body() dto: MotivoDto,
  ) {
    return this.service.revisarFactura(
      user.companyId,
      facturaId,
      false,
      user.email,
      dto.motivo,
    );
  }

  @Get(':pagoId/soporte-url')
  urlSoporte(
    @CurrentUser() user: AuthenticatedUser,
    @Param('pagoId') pagoId: string,
  ) {
    return this.service.urlDescargaSoporte(user.companyId, pagoId);
  }

  @Roles(...PAGAN)
  @Post(':pagoId/soporte/upload-url')
  urlSubidaSoporte(
    @CurrentUser() user: AuthenticatedUser,
    @Param('pagoId') pagoId: string,
    @Body() dto: UploadArchivoDto,
  ) {
    return this.service.urlSubidaSoporte(user.companyId, pagoId, dto.filename);
  }

  @Roles(...PAGAN)
  @Post(':pagoId/pagar')
  pagar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('pagoId') pagoId: string,
    @Body() dto: RegistrarPagoDto,
  ) {
    return this.service.registrarPago(user.companyId, pagoId, dto, user.email);
  }

  @Roles(...PAGAN)
  @Post('pronto-pago/:solicitudId/aceptar')
  aceptarProntoPago(
    @CurrentUser() user: AuthenticatedUser,
    @Param('solicitudId') solicitudId: string,
  ) {
    return this.service.responderProntoPago(
      user.companyId,
      solicitudId,
      true,
      user.email,
    );
  }

  @Roles(...PAGAN)
  @Post('pronto-pago/:solicitudId/rechazar')
  rechazarProntoPago(
    @CurrentUser() user: AuthenticatedUser,
    @Param('solicitudId') solicitudId: string,
    @Body() dto: MotivoDto,
  ) {
    return this.service.responderProntoPago(
      user.companyId,
      solicitudId,
      false,
      user.email,
      dto.motivo,
    );
  }
}
