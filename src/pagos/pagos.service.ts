import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  EstadoFactura,
  EstadoPago,
  EstadoProntoPago,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProveedoresService } from '../proveedores/proveedores.service';
import { StorageService } from '../storage/storage.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { formatContratoCodigo } from '../common/utils/codigo.util';
import { formatMonto } from '../common/utils/moneda.util';
import {
  calcularProntoPago,
  estadoEfectivo,
  FACTURAS_BUCKET,
  fechaPactadaDesde,
  MAX_BYTES_FACTURA,
  MIME_FACTURA,
} from './pagos.rules';
import { RadicarFacturaDto } from './dto/pagos.dto';

/** What both portals need to show one payment. */
export const INCLUDE_PAGO = {
  contrato: {
    select: {
      id: true,
      numero: true,
      tipo: true,
      categoria: true,
      condicionesPagoDias: true,
      companyId: true,
      company: { select: { nombre: true } },
    },
  },
  proveedor: { select: { id: true, nombre: true } },
  facturas: { orderBy: { createdAt: 'desc' } },
  solicitudesProntoPago: { orderBy: { createdAt: 'desc' } },
  hitoOrigen: { select: { label: true } },
} satisfies Prisma.PagoPOInclude;

type PagoCompleto = Prisma.PagoPOGetPayload<{ include: typeof INCLUDE_PAGO }>;

/** Flattens a payment for the screens: codes, the live invoice and effective state. */
export function vistaPago(p: PagoCompleto, ahora = new Date()) {
  const { contrato, facturas, solicitudesProntoPago, hitoOrigen, ...pago } = p;
  const facturaVigente =
    facturas.find((f) => f.estado !== EstadoFactura.RECHAZADA) ?? null;
  return {
    ...pago,
    estado: estadoEfectivo(p.estado, p.fechaPagoPactada, ahora),
    contratoId: contrato.id,
    contrato: formatContratoCodigo(contrato.tipo, contrato.numero),
    categoria: contrato.categoria,
    cliente: contrato.company.nombre,
    proveedor: p.proveedor.nombre,
    concepto: hitoOrigen?.label ?? null,
    condicionesPagoDias: contrato.condicionesPagoDias,
    montoNeto: pago.monto - pago.descuentoProntoPago,
    facturaVigente,
    facturas,
    prontoPago: solicitudesProntoPago[0] ?? null,
  };
}

/** Payments seen from the proveedor: invoicing and early-payment requests. */
@Injectable()
export class PagosService implements OnModuleInit {
  private readonly logger = new Logger(PagosService.name);

  constructor(
    private prisma: PrismaService,
    private proveedores: ProveedoresService,
    private storage: StorageService,
    private notificaciones: NotificacionesService,
    private auditLog: AuditLogService,
  ) {}

  onModuleInit() {
    this.storage
      .ensureBucket(FACTURAS_BUCKET, {
        fileSizeLimit: MAX_BYTES_FACTURA,
        allowedMimeTypes: MIME_FACTURA,
      })
      .then((ok) => {
        if (!ok)
          this.logger.warn(
            `No se pudo verificar/crear el bucket "${FACTURAS_BUCKET}" en Supabase Storage.`,
          );
      })
      .catch((err: Error) =>
        this.logger.warn(`Bucket "${FACTURAS_BUCKET}": ${err.message}`),
      );
  }

  async listMine(userId: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const pagos = await this.prisma.pagoPO.findMany({
      where: { proveedorId },
      include: INCLUDE_PAGO,
      orderBy: [{ fechaPagoPactada: 'desc' }, { id: 'desc' }],
      take: 300,
    });
    const ahora = new Date();
    return pagos.map((p) => vistaPago(p, ahora));
  }

  private async miPago(userId: string, pagoId: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const pago = await this.prisma.pagoPO.findFirst({
      where: { id: pagoId, proveedorId },
      include: INCLUDE_PAGO,
    });
    if (!pago) throw new NotFoundException('Pago no encontrado.');
    return pago;
  }

  async urlSubidaFactura(userId: string, pagoId: string, filename: string) {
    const pago = await this.miPago(userId, pagoId);
    if (pago.estado === EstadoPago.PAGADO)
      throw new ConflictException('Este pago ya fue registrado.');
    const path = `${pago.proveedorId}/${pago.id}/${Date.now()}-${this.storage.safeFilename(filename)}`;
    return this.storage.createUploadUrl(FACTURAS_BUCKET, path);
  }

  /**
   * Files the invoice for a released payment. The payment term starts
   * counting today (the agreed date moves to today + the contract's days);
   * a rejected invoice can be replaced by filing a new one.
   */
  async radicarFactura(
    userId: string,
    pagoId: string,
    dto: RadicarFacturaDto,
    actorNombre: string,
  ) {
    const pago = await this.miPago(userId, pagoId);
    if (pago.estado === EstadoPago.PAGADO)
      throw new ConflictException('Este pago ya fue registrado.');
    if (!dto.path.startsWith(`${pago.proveedorId}/${pago.id}/`))
      throw new BadRequestException('Ruta de archivo inválida.');
    const emision = new Date(dto.fechaEmision);
    const ahora = new Date();
    if (emision.getTime() > ahora.getTime() + 86_400_000)
      throw new BadRequestException('La fecha de emisión no puede ser futura.');
    const fechaPagoPactada = fechaPactadaDesde(
      ahora,
      pago.contrato.condicionesPagoDias,
    );
    const factura = await this.prisma.$transaction(async (tx) => {
      // Re-checked inside the transaction: a double submit files only one.
      const activa = await tx.factura.count({
        where: { pagoId, estado: { not: EstadoFactura.RECHAZADA } },
      });
      if (activa > 0)
        throw new ConflictException('Este pago ya tiene una factura radicada.');
      const factura = await tx.factura.create({
        data: {
          pagoId,
          numero: dto.numero.trim(),
          fechaEmision: emision,
          monto: pago.monto,
          archivoPath: dto.path,
          archivoNombre: dto.nombre,
        },
      });
      await tx.pagoPO.update({
        where: { id: pagoId },
        data: { fechaPagoPactada, estado: EstadoPago.PENDIENTE },
      });
      return factura;
    });
    await this.auditLog.log({
      companyId: pago.contrato.companyId,
      usuario: actorNombre,
      accion: 'Factura radicada',
      detalle: `${dto.numero} de ${pago.proveedor.nombre} — ${formatContratoCodigo(pago.contrato.tipo, pago.contrato.numero)} (${formatMonto(pago.monto, pago.moneda)})`,
    });
    await this.notificarCliente(
      pago.contrato.companyId,
      [Role.COMPRADOR, Role.ADMIN_CLIENTE, Role.APROBADOR_CFO],
      'Nueva factura por revisar',
      `${pago.proveedor.nombre} radicó la factura ${dto.numero} por ${formatMonto(pago.monto, pago.moneda)}.`,
      `/cliente/pagos?pago=${pago.id}`,
    );
    return factura;
  }

  async urlDescargaFactura(userId: string, pagoId: string, facturaId: string) {
    const pago = await this.miPago(userId, pagoId);
    const factura = pago.facturas.find((f) => f.id === facturaId);
    if (!factura) throw new NotFoundException('Factura no encontrada.');
    const { url } = await this.storage.createDownloadUrl(
      FACTURAS_BUCKET,
      factura.archivoPath,
    );
    return { url, nombre: factura.archivoNombre };
  }

  async urlDescargaSoporte(userId: string, pagoId: string) {
    const pago = await this.miPago(userId, pagoId);
    if (!pago.soportePath)
      throw new NotFoundException('Este pago no tiene soporte adjunto.');
    const { url } = await this.storage.createDownloadUrl(
      FACTURAS_BUCKET,
      pago.soportePath,
    );
    return { url, nombre: pago.soporteNombre };
  }

  async simularProntoPago(
    userId: string,
    pagoId: string,
    fechaPropuesta: string,
  ) {
    const pago = await this.miPago(userId, pagoId);
    this.validarProntoPago(pago, new Date(fechaPropuesta));
    return {
      montoOriginal: pago.monto,
      ...calcularProntoPago(
        pago.monto,
        pago.fechaPagoPactada,
        new Date(fechaPropuesta),
      ),
    };
  }

  /** Asks the buyer to pay earlier in exchange for the pro-rated discount. */
  async solicitarProntoPago(
    userId: string,
    pagoId: string,
    fechaPropuesta: string,
    actorNombre: string,
  ) {
    const pago = await this.miPago(userId, pagoId);
    const propuesta = new Date(fechaPropuesta);
    this.validarProntoPago(pago, propuesta);
    const calculo = calcularProntoPago(
      pago.monto,
      pago.fechaPagoPactada,
      propuesta,
    );
    const solicitud = await this.prisma.$transaction(async (tx) => {
      const abierta = await tx.solicitudProntoPago.count({
        where: { pagoId, estado: EstadoProntoPago.SOLICITADA },
      });
      if (abierta > 0)
        throw new ConflictException(
          'Ya tienes una solicitud de pronto pago en revisión.',
        );
      return tx.solicitudProntoPago.create({
        data: {
          pagoId,
          fechaPropuesta: propuesta,
          descuentoPct: calculo.descuentoPct,
          montoNeto: calculo.montoNeto,
        },
      });
    });
    await this.auditLog.log({
      companyId: pago.contrato.companyId,
      usuario: actorNombre,
      accion: 'Pronto pago solicitado',
      detalle: `${pago.proveedor.nombre} — ${formatContratoCodigo(pago.contrato.tipo, pago.contrato.numero)}: ${formatMonto(calculo.montoNeto, pago.moneda)} el ${propuesta.toISOString().slice(0, 10)}`,
    });
    await this.notificarCliente(
      pago.contrato.companyId,
      [Role.ADMIN_CLIENTE, Role.APROBADOR_CFO],
      'Solicitud de pronto pago',
      `${pago.proveedor.nombre} ofrece ${(calculo.descuentoPct * 100).toLocaleString('es-CO', { maximumFractionDigits: 2 })}% de descuento por pagar ${calculo.dias} días antes.`,
      `/cliente/pagos?pago=${pago.id}`,
    );
    return solicitud;
  }

  private validarProntoPago(pago: PagoCompleto, propuesta: Date) {
    if (Number.isNaN(propuesta.getTime()))
      throw new BadRequestException('Fecha inválida.');
    if (pago.estado === EstadoPago.PAGADO)
      throw new ConflictException('Este pago ya fue registrado.');
    if (pago.disputaAbierta)
      throw new BadRequestException(
        'No disponible: la PO tiene una disputa abierta.',
      );
    if (pago.descuentoProntoPago > 0)
      throw new ConflictException(
        'Este pago ya tiene un pronto pago acordado.',
      );
    if (!pago.facturas.some((f) => f.estado === EstadoFactura.APROBADA))
      throw new BadRequestException(
        'El pronto pago está disponible cuando tu factura ha sido aprobada.',
      );
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    if (propuesta < hoy)
      throw new BadRequestException('La fecha propuesta no puede ser pasada.');
    if (propuesta >= pago.fechaPagoPactada)
      throw new BadRequestException(
        'La fecha propuesta debe ser anterior a la fecha de pago pactada.',
      );
  }

  private async notificarCliente(
    companyId: string,
    roles: Role[],
    titulo: string,
    desc: string,
    link: string,
  ) {
    const miembros = await this.prisma.companyMembership.findMany({
      where: {
        companyId,
        activo: true,
        user: { role: { in: roles }, activo: true },
      },
      select: { userId: true },
    });
    await Promise.all(
      miembros.map((m) =>
        this.notificaciones.create(m.userId, 'CONTRATO', titulo, desc, link),
      ),
    );
  }
}
