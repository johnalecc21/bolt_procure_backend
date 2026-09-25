import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EstadoContrato,
  EstadoHito,
  EstadoRequerimiento,
  HitoSeguimiento,
  Role,
  TipoContrato,
  TipoEventoErp,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import {
  formatContratoCodigo,
  formatRequerimientoCodigo,
} from '../common/utils/codigo.util';
import { CreateHitoDto } from './dto/create-hito.dto';
import { UpdateHitoDto } from './dto/update-hito.dto';
import { formatMonto } from '../common/utils/moneda.util';
import { ErpEventosService } from '../integraciones/erp-eventos.service';
import {
  esMarco,
  estadoHitoAutomatico,
  ESTADOS_OPERATIVOS,
  porcentajeAsignado,
} from '../contratos/contratos.rules';

/** Milestone as the screens get it: its state already reflects its dates. */
export function vistaHito<T extends HitoSeguimiento>(h: T, ahora = new Date()) {
  return { ...h, estado: estadoHitoAutomatico(h, ahora) };
}

@Injectable()
export class SeguimientoService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private notificaciones: NotificacionesService,
    private erp: ErpEventosService,
  ) {}

  async list(companyId: string) {
    const contratos = await this.prisma.contrato.findMany({
      where: { companyId },
      orderBy: { vigenciaFin: 'asc' },
      include: { hitos: { orderBy: { orden: 'asc' } } },
      // Growth guard-rail, not page size — same cap as contratos.service.ts's
      // list(), which queries the same table.
      take: 200,
    });
    const ahora = new Date();
    return contratos.map((c) => ({
      ...c,
      esMarco: esMarco(c),
      porcentajeAsignado: porcentajeAsignado(c.hitos),
      hitos: c.hitos.map((h) => vistaHito(h, ahora)),
    }));
  }

  private async contratoEditable(companyId: string, contratoId: string) {
    const contrato = await this.prisma.contrato.findFirst({
      where: { id: contratoId, companyId },
      include: { hitos: true },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado.');
    if (contrato.estado === EstadoContrato.TERMINADO)
      throw new ConflictException(
        'El contrato fue terminado; sus hitos ya no se modifican.',
      );
    return contrato;
  }

  private validarPorcentaje(
    contrato: {
      tipo: TipoContrato;
      contratoPadreId: string | null;
      hitos: HitoSeguimiento[];
    },
    porcentaje: number,
    hitoId?: string,
  ) {
    if (porcentaje <= 0) return;
    if (esMarco(contrato))
      throw new BadRequestException(
        'Un Contrato Marco no se paga por hitos: emite órdenes de compra contra él y cada una tendrá sus hitos de pago.',
      );
    const otros = porcentajeAsignado(contrato.hitos, hitoId);
    if (otros + porcentaje > 100)
      throw new BadRequestException(
        `Los hitos de pago no pueden sumar más de 100%: ya hay ${otros}% asignado, quedan ${100 - otros}%.`,
      );
  }

  async crearHito(companyId: string, contratoId: string, dto: CreateHitoDto) {
    const contrato = await this.contratoEditable(companyId, contratoId);
    this.validarPorcentaje(contrato, dto.porcentaje ?? 0);
    return this.prisma.hitoSeguimiento.create({
      data: {
        contratoId,
        label: dto.label,
        comprometido: new Date(dto.comprometido),
        orden: contrato.hitos.length,
        porcentaje: dto.porcentaje ?? 0,
      },
    });
  }

  async actualizarHito(
    companyId: string,
    hitoId: string,
    dto: UpdateHitoDto,
    actorNombre: string,
  ) {
    const hito = await this.prisma.hitoSeguimiento.findFirst({
      where: { id: hitoId, contrato: { companyId } },
      include: { contrato: true },
    });
    if (!hito) throw new NotFoundException('Hito no encontrado.');
    const contrato = await this.contratoEditable(companyId, hito.contratoId);

    // Once it released money, only its name can change: the payment, its
    // amount and the delivery record behind it are final.
    if (hito.pagoGeneradoId) {
      const tocaAlgoMas =
        (dto.estado !== undefined && dto.estado !== EstadoHito.COMPLETADO) ||
        (dto.porcentaje !== undefined && dto.porcentaje !== hito.porcentaje) ||
        dto.comprometido !== undefined;
      if (tocaAlgoMas)
        throw new ConflictException(
          'Este hito ya generó su pago: no se puede reabrir ni cambiar su porcentaje o fecha.',
        );
    }
    if (dto.porcentaje !== undefined)
      this.validarPorcentaje(contrato, dto.porcentaje, hitoId);

    const pasaACompletado =
      dto.estado === EstadoHito.COMPLETADO &&
      hito.estado !== EstadoHito.COMPLETADO;
    const saleDeCompletado =
      dto.estado !== undefined &&
      dto.estado !== EstadoHito.COMPLETADO &&
      hito.estado === EstadoHito.COMPLETADO;

    const actualizado = await this.prisma.hitoSeguimiento.update({
      where: { id: hitoId },
      data: {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.comprometido !== undefined
          ? { comprometido: new Date(dto.comprometido) }
          : {}),
        ...(dto.porcentaje !== undefined ? { porcentaje: dto.porcentaje } : {}),
        ...(dto.estado !== undefined
          ? {
              estado: dto.estado,
              real: pasaACompletado
                ? new Date()
                : saleDeCompletado
                  ? null
                  : hito.real,
            }
          : {}),
      },
    });

    // Completing a hito with a payment % attached releases a real PagoPO —
    // the whole point of splitting a contract into milestones instead of
    // paying 100% upfront.
    const porcentaje = dto.porcentaje ?? hito.porcentaje;
    if (pasaACompletado && porcentaje > 0) {
      const proveedorId = hito.contrato.proveedorId;
      if (proveedorId) {
        const monto = Math.round((hito.contrato.monto * porcentaje) / 100);
        const fechaPagoPactada = new Date();
        fechaPagoPactada.setDate(
          fechaPagoPactada.getDate() + hito.contrato.condicionesPagoDias,
        );
        // A PagoPO created without its hito ever being linked back to it would
        // be an orphaned payment record with no hito pointing at it — both
        // writes need to land together.
        await this.prisma.$transaction(async (tx) => {
          const pago = await tx.pagoPO.create({
            data: {
              contratoId: hito.contratoId,
              proveedorId,
              monto,
              moneda: hito.contrato.moneda,
              fechaEmision: new Date(),
              fechaPagoPactada,
            },
          });
          // Only the first completion links a payment; a concurrent second one
          // finds pagoGeneradoId already set and rolls its own payment back.
          const { count } = await tx.hitoSeguimiento.updateMany({
            where: { id: hitoId, pagoGeneradoId: null },
            data: { pagoGeneradoId: pago.id },
          });
          if (count === 0)
            throw new ConflictException('Este hito ya generó su pago.');
        });
        await this.auditLog.log({
          companyId,
          usuario: actorNombre,
          accion: 'Pago generado por hito completado',
          detalle: `${formatContratoCodigo(hito.contrato.tipo, hito.contrato.numero)} — ${hito.label} (${porcentaje}%) → ${formatMonto(monto, hito.contrato.moneda)}`,
        });
        const proveedor = await this.prisma.proveedorProfile.findUnique({
          where: { id: proveedorId },
          include: { user: true },
        });
        if (proveedor?.user) {
          await this.notificaciones.create(
            proveedor.user.id,
            'CONTRATO',
            'Hito completado: radica tu factura',
            `"${hito.label}" de ${formatContratoCodigo(hito.contrato.tipo, hito.contrato.numero)} fue recibido. Se liberó un pago de ${formatMonto(monto, hito.contrato.moneda)}; radica la factura para que empiece a correr el plazo de ${hito.contrato.condicionesPagoDias} días.`,
            '/proveedor/pagos',
          );
        }
      }
    }

    // The ERP records the goods/service receipt (and the payment it released).
    if (pasaACompletado)
      await this.erp.emitir(companyId, TipoEventoErp.RECEPCION, hitoId);
    if (hito.contrato.requerimientoId)
      await this.cerrarSiCompleto(
        companyId,
        hito.contrato.requerimientoId,
        actorNombre,
      );
    return vistaHito(actualizado);
  }

  /**
   * The purchase process ends by itself once every milestone of its contracts
   * is done — unless a Contrato Marco is still open (more POs may come).
   * Terminated contracts don't hold it open.
   */
  async cerrarSiCompleto(
    companyId: string,
    requerimientoId: string,
    actorNombre: string,
  ) {
    const contratos = await this.prisma.contrato.findMany({
      where: { requerimientoId },
      select: {
        tipo: true,
        contratoPadreId: true,
        estado: true,
        hitos: { select: { estado: true } },
      },
    });
    const vivos = contratos.filter(
      (c) => c.estado !== EstadoContrato.TERMINADO,
    );
    if (vivos.some((c) => esMarco(c) && ESTADOS_OPERATIVOS.includes(c.estado)))
      return;
    const pendientes = vivos.some((c) =>
      c.hitos.some((h) => h.estado !== EstadoHito.COMPLETADO),
    );
    if (pendientes) return;
    const { count } = await this.prisma.requerimiento.updateMany({
      where: {
        id: requerimientoId,
        estado: EstadoRequerimiento.EN_CUMPLIMIENTO,
      },
      data: { estado: EstadoRequerimiento.CERRADO },
    });
    if (count === 0) return;
    const { numero } = await this.prisma.requerimiento.findUniqueOrThrow({
      where: { id: requerimientoId },
      select: { numero: true },
    });
    await this.auditLog.log({
      companyId,
      usuario: actorNombre,
      accion: 'Proceso cerrado',
      detalle: `${formatRequerimientoCodigo(numero)}: todos los contratos cumplidos o terminados`,
    });
  }

  async eliminarHito(companyId: string, hitoId: string, actorNombre: string) {
    const hito = await this.prisma.hitoSeguimiento.findFirst({
      where: { id: hitoId, contrato: { companyId } },
      include: { contrato: true },
    });
    if (!hito) throw new NotFoundException('Hito no encontrado.');
    await this.contratoEditable(companyId, hito.contratoId);
    if (hito.pagoGeneradoId)
      throw new ConflictException(
        'Este hito ya generó su pago y no se puede eliminar.',
      );
    await this.prisma.hitoSeguimiento.delete({ where: { id: hitoId } });
    if (hito.contrato.requerimientoId)
      await this.cerrarSiCompleto(
        companyId,
        hito.contrato.requerimientoId,
        actorNombre,
      );
    return { ok: true };
  }

  /** The proveedor tells the buyer a milestone is delivered or how it's going. */
  async reportarAvance(
    userId: string,
    proveedorId: string,
    hitoId: string,
    nota: string,
  ) {
    const hito = await this.prisma.hitoSeguimiento.findFirst({
      where: { id: hitoId, contrato: { proveedorId } },
      include: { contrato: true },
    });
    if (!hito) throw new NotFoundException('Hito no encontrado.');
    if (hito.contrato.estado === EstadoContrato.TERMINADO)
      throw new ConflictException('El contrato fue terminado.');
    if (hito.estado === EstadoHito.COMPLETADO)
      throw new ConflictException('Este hito ya fue recibido por el cliente.');
    const actualizado = await this.prisma.hitoSeguimiento.update({
      where: { id: hitoId },
      data: { avanceProveedor: nota.trim(), avanceReportadoAt: new Date() },
    });
    const codigo = formatContratoCodigo(
      hito.contrato.tipo,
      hito.contrato.numero,
    );
    await this.auditLog.log({
      companyId: hito.contrato.companyId,
      usuario: hito.contrato.proveedorNombre,
      usuarioId: userId,
      accion: 'Avance reportado por el proveedor',
      detalle: `${codigo} — ${hito.label}: ${nota.trim()}`,
    });
    const miembros = await this.prisma.companyMembership.findMany({
      where: {
        companyId: hito.contrato.companyId,
        activo: true,
        user: {
          role: { in: [Role.COMPRADOR, Role.ADMIN_CLIENTE] },
          activo: true,
        },
      },
      select: { userId: true },
    });
    await Promise.all(
      miembros.map((m) =>
        this.notificaciones.create(
          m.userId,
          'CONTRATO',
          `Avance de ${hito.contrato.proveedorNombre}`,
          `${codigo} — "${hito.label}": ${nota.trim()}. Revísalo y márcalo como completado si lo recibiste.`,
          `/cliente/contratos/${hito.contratoId}`,
        ),
      ),
    );
    return vistaHito(actualizado);
  }
}
