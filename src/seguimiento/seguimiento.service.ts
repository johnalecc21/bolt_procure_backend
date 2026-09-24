import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EstadoHito, EstadoRequerimiento } from '@prisma/client';
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

@Injectable()
export class SeguimientoService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private notificaciones: NotificacionesService,
  ) {}

  list(companyId: string) {
    return this.prisma.contrato.findMany({
      where: { companyId },
      orderBy: { vigenciaFin: 'asc' },
      include: { hitos: { orderBy: { orden: 'asc' } } },
      // Growth guard-rail, not page size — same cap as contratos.service.ts's
      // list(), which queries the same table.
      take: 200,
    });
  }

  async crearHito(companyId: string, contratoId: string, dto: CreateHitoDto) {
    const contrato = await this.prisma.contrato.findFirst({
      where: { id: contratoId, companyId },
      include: { _count: { select: { hitos: true } } },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado.');
    return this.prisma.hitoSeguimiento.create({
      data: {
        contratoId,
        label: dto.label,
        comprometido: new Date(dto.comprometido),
        orden: contrato._count.hitos,
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
      include: {
        contrato: true,
      },
    });
    if (!hito) throw new NotFoundException('Hito no encontrado.');

    const pasaACompletado =
      dto.estado === EstadoHito.COMPLETADO &&
      hito.estado !== EstadoHito.COMPLETADO;

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
              real:
                dto.estado === EstadoHito.COMPLETADO
                  ? (hito.real ?? new Date())
                  : hito.real,
            }
          : {}),
      },
    });

    // Completing a hito with a payment % attached releases a real PagoPO —
    // the whole point of splitting a contract into milestones instead of
    // paying 100% upfront.
    if (pasaACompletado && hito.porcentaje > 0) {
      const proveedorId = hito.contrato.proveedorId;
      if (proveedorId) {
        const monto = Math.round((hito.contrato.monto * hito.porcentaje) / 100);
        const fechaPagoPactada = new Date();
        fechaPagoPactada.setDate(
          fechaPagoPactada.getDate() + hito.contrato.condicionesPagoDias,
        );
        // A PagoPO created without its hito ever being linked back to it would
        // be an orphaned payment record with no hito pointing at it — both
        // writes need to land together.
        const [pago] = await this.prisma.$transaction(async (tx) => {
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
          return [pago];
        });
        await this.auditLog.log({
          companyId,
          usuario: actorNombre,
          accion: 'Pago generado por hito completado',
          detalle: `${formatContratoCodigo(hito.contrato.tipo, hito.contrato.numero)} — ${hito.label} (${hito.porcentaje}%) → ${formatMonto(monto, hito.contrato.moneda)}`,
        });
        const proveedor = await this.prisma.proveedorProfile.findUnique({
          where: { id: proveedorId },
          include: { user: true },
        });
        if (proveedor?.user) {
          await this.notificaciones.create(
            proveedor.user.id,
            'CONTRATO',
            'Nuevo pago generado',
            `"${hito.label}" fue marcado como completado — se generó un pago de ${formatMonto(monto, hito.contrato.moneda)} en ${hito.contrato.condicionesPagoDias} días.`,
            '/proveedor/pagos',
          );
        }
      }
    }

    if (hito.contrato.requerimientoId)
      await this.cerrarSiCompleto(
        companyId,
        hito.contrato.requerimientoId,
        actorNombre,
      );
    return actualizado;
  }

  /** The purchase process ends by itself once every milestone of its contracts is done. */
  private async cerrarSiCompleto(
    companyId: string,
    requerimientoId: string,
    actorNombre: string,
  ) {
    const pendientes = await this.prisma.hitoSeguimiento.count({
      where: {
        contrato: { requerimientoId },
        estado: { not: EstadoHito.COMPLETADO },
      },
    });
    if (pendientes > 0) return;
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
      detalle: `${formatRequerimientoCodigo(numero)}: todos los hitos completados`,
    });
  }

  async eliminarHito(companyId: string, hitoId: string) {
    const hito = await this.prisma.hitoSeguimiento.findFirst({
      where: { id: hitoId, contrato: { companyId } },
    });
    if (!hito) throw new NotFoundException('Hito no encontrado.');
    await this.prisma.hitoSeguimiento.delete({ where: { id: hitoId } });
    return { ok: true };
  }
}
