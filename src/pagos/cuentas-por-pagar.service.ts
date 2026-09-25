import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EstadoFactura, EstadoPago, TipoEventoErp } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { formatContratoCodigo } from '../common/utils/codigo.util';
import { formatMonto } from '../common/utils/moneda.util';
import { FACTURAS_BUCKET } from './pagos.rules';
import { INCLUDE_PAGO, vistaPago } from './pagos.service';
import { RegistrarPagoDto } from './dto/pagos.dto';
import { ErpEventosService } from '../integraciones/erp-eventos.service';

/** Accounts payable for the buyer: review invoices, pay, answer early-payment requests. */
@Injectable()
export class CuentasPorPagarService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private notificaciones: NotificacionesService,
    private auditLog: AuditLogService,
    private erp: ErpEventosService,
  ) {}

  async list(companyId: string) {
    const pagos = await this.prisma.pagoPO.findMany({
      where: { contrato: { companyId } },
      include: INCLUDE_PAGO,
      orderBy: [{ fechaPagoPactada: 'desc' }, { id: 'desc' }],
      take: 500,
    });
    const ahora = new Date();
    return pagos.map((p) => vistaPago(p, ahora));
  }

  private async pagoDeEmpresa(companyId: string, pagoId: string) {
    const pago = await this.prisma.pagoPO.findFirst({
      where: { id: pagoId, contrato: { companyId } },
      include: {
        ...INCLUDE_PAGO,
        proveedor: { select: { id: true, nombre: true, userId: true } },
      },
    });
    if (!pago) throw new NotFoundException('Pago no encontrado.');
    return pago;
  }

  private async facturaDeEmpresa(companyId: string, facturaId: string) {
    const factura = await this.prisma.factura.findFirst({
      where: { id: facturaId, pago: { contrato: { companyId } } },
    });
    if (!factura) throw new NotFoundException('Factura no encontrada.');
    return {
      factura,
      pago: await this.pagoDeEmpresa(companyId, factura.pagoId),
    };
  }

  async urlDescargaFactura(companyId: string, facturaId: string) {
    const { factura } = await this.facturaDeEmpresa(companyId, facturaId);
    const { url } = await this.storage.createDownloadUrl(
      FACTURAS_BUCKET,
      factura.archivoPath,
    );
    return { url, nombre: factura.archivoNombre };
  }

  async urlDescargaSoporte(companyId: string, pagoId: string) {
    const pago = await this.pagoDeEmpresa(companyId, pagoId);
    if (!pago.soportePath)
      throw new NotFoundException('Este pago no tiene soporte adjunto.');
    const { url } = await this.storage.createDownloadUrl(
      FACTURAS_BUCKET,
      pago.soportePath,
    );
    return { url, nombre: pago.soporteNombre };
  }

  async revisarFactura(
    companyId: string,
    facturaId: string,
    aprobar: boolean,
    actorNombre: string,
    motivo?: string,
  ) {
    const { factura, pago } = await this.facturaDeEmpresa(companyId, facturaId);
    // Conditional: only a filed invoice can be decided, and only once.
    const { count } = await this.prisma.factura.updateMany({
      where: { id: facturaId, estado: EstadoFactura.RADICADA },
      data: {
        estado: aprobar ? EstadoFactura.APROBADA : EstadoFactura.RECHAZADA,
        motivoRechazo: aprobar ? null : motivo,
        revisadaPor: actorNombre,
        revisadaAt: new Date(),
      },
    });
    if (count === 0)
      throw new ConflictException('Esta factura ya fue revisada.');
    const contrato = formatContratoCodigo(
      pago.contrato.tipo,
      pago.contrato.numero,
    );
    await this.auditLog.log({
      companyId,
      usuario: actorNombre,
      accion: aprobar ? 'Factura aprobada' : 'Factura rechazada',
      detalle: `${factura.numero} de ${pago.proveedor.nombre} — ${contrato}${aprobar ? '' : `: ${motivo}`}`,
    });
    if (pago.proveedor.userId) {
      await this.notificaciones.create(
        pago.proveedor.userId,
        'CONTRATO',
        aprobar ? 'Factura aprobada' : 'Factura rechazada',
        aprobar
          ? `Tu factura ${factura.numero} (${contrato}) fue aprobada; se pagará el ${pago.fechaPagoPactada.toISOString().slice(0, 10)}.`
          : `Tu factura ${factura.numero} (${contrato}) fue rechazada: ${motivo}. Corrígela y radícala de nuevo.`,
        `/proveedor/pagos?pago=${pago.id}`,
      );
    }
    if (aprobar)
      await this.erp.emitir(companyId, TipoEventoErp.FACTURA, facturaId);
    return { ok: true };
  }

  async urlSubidaSoporte(companyId: string, pagoId: string, filename: string) {
    const pago = await this.pagoDeEmpresa(companyId, pagoId);
    const path = `${pago.proveedorId}/${pago.id}/soporte-${Date.now()}-${this.storage.safeFilename(filename)}`;
    return this.storage.createUploadUrl(FACTURAS_BUCKET, path);
  }

  /** Registers the bank transfer: needs an approved invoice; the net of any early-payment discount. */
  async registrarPago(
    companyId: string,
    pagoId: string,
    dto: RegistrarPagoDto,
    actorNombre: string,
    desdeErp = false,
  ) {
    const pago = await this.pagoDeEmpresa(companyId, pagoId);
    if (!pago.facturas.some((f) => f.estado === EstadoFactura.APROBADA))
      throw new BadRequestException(
        'Aprueba la factura del proveedor antes de registrar el pago.',
      );
    if (
      dto.soportePath &&
      !dto.soportePath.startsWith(`${pago.proveedorId}/${pago.id}/`)
    )
      throw new BadRequestException('Ruta de archivo inválida.');
    const fechaPago = new Date(dto.fechaPago);
    if (fechaPago.getTime() > Date.now() + 86_400_000)
      throw new BadRequestException('La fecha de pago no puede ser futura.');
    const montoPagado = pago.monto;
    const { count } = await this.prisma.pagoPO.updateMany({
      where: { id: pagoId, estado: { not: EstadoPago.PAGADO } },
      data: {
        estado: EstadoPago.PAGADO,
        fechaPago,
        montoPagado,
        referenciaPago: dto.referencia.trim(),
        soportePath: dto.soportePath ?? null,
        soporteNombre: dto.soporteNombre ?? null,
        pagadoPor: actorNombre,
      },
    });
    if (count === 0)
      throw new ConflictException('Este pago ya fue registrado.');
    const contrato = formatContratoCodigo(
      pago.contrato.tipo,
      pago.contrato.numero,
    );
    await this.auditLog.log({
      companyId,
      usuario: actorNombre,
      accion: 'Pago registrado',
      detalle: `${formatMonto(montoPagado, pago.moneda)} a ${pago.proveedor.nombre} — ${contrato} (ref. ${dto.referencia})`,
    });
    if (pago.proveedor.userId) {
      await this.notificaciones.create(
        pago.proveedor.userId,
        'CONTRATO',
        'Pago realizado',
        `Recibirás ${formatMonto(montoPagado, pago.moneda)} por ${contrato} (referencia ${dto.referencia}).`,
        `/proveedor/pagos?pago=${pago.id}`,
      );
    }
    // A payment reported by the ERP itself isn't echoed back to it.
    if (!desdeErp) await this.erp.emitir(companyId, TipoEventoErp.PAGO, pagoId);
    return { ok: true };
  }
}
