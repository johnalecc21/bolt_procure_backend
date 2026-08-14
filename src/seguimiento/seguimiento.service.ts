import { Injectable, NotFoundException } from '@nestjs/common';
import { EstadoHito } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { CreateHitoDto } from './dto/create-hito.dto';
import { UpdateHitoDto } from './dto/update-hito.dto';

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

  async actualizarHito(companyId: string, hitoId: string, dto: UpdateHitoDto, actorNombre: string) {
    const hito = await this.prisma.hitoSeguimiento.findFirst({
      where: { id: hitoId, contrato: { companyId } },
      include: {
        contrato: {
          include: { requerimiento: { include: { adjudicacion: true } } },
        },
      },
    });
    if (!hito) throw new NotFoundException('Hito no encontrado.');

    const pasaACompletado = dto.estado === EstadoHito.COMPLETADO && hito.estado !== EstadoHito.COMPLETADO;

    const actualizado = await this.prisma.hitoSeguimiento.update({
      where: { id: hitoId },
      data: {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.comprometido !== undefined ? { comprometido: new Date(dto.comprometido) } : {}),
        ...(dto.porcentaje !== undefined ? { porcentaje: dto.porcentaje } : {}),
        ...(dto.estado !== undefined
          ? { estado: dto.estado, real: dto.estado === EstadoHito.COMPLETADO ? (hito.real ?? new Date()) : hito.real }
          : {}),
      },
    });

    // Completing a hito with a payment % attached releases a real PagoPO —
    // the whole point of splitting a contract into milestones instead of
    // paying 100% upfront.
    if (pasaACompletado && hito.porcentaje > 0) {
      const proveedorId = hito.contrato.requerimiento?.adjudicacion?.proveedorId;
      if (proveedorId) {
        const monto = Math.round((hito.contrato.monto * hito.porcentaje) / 100);
        const fechaPagoPactada = new Date();
        fechaPagoPactada.setDate(fechaPagoPactada.getDate() + hito.contrato.condicionesPagoDias);
        const pago = await this.prisma.pagoPO.create({
          data: {
            contratoId: hito.contratoId,
            proveedorId,
            monto,
            fechaEmision: new Date(),
            fechaPagoPactada,
          },
        });
        await this.prisma.hitoSeguimiento.update({ where: { id: hitoId }, data: { pagoGeneradoId: pago.id } });
        await this.auditLog.log({
          companyId,
          usuario: actorNombre,
          accion: 'Pago generado por hito completado',
          detalle: `${hito.contratoId} — ${hito.label} (${hito.porcentaje}%) → $${monto.toLocaleString()}`,
        });
        const proveedor = await this.prisma.proveedorProfile.findUnique({ where: { id: proveedorId }, include: { user: true } });
        if (proveedor?.user) {
          await this.notificaciones.create(
            proveedor.user.id,
            'CONTRATO',
            'Nuevo pago generado',
            `"${hito.label}" fue marcado como completado — se generó un pago de $${monto.toLocaleString()} en ${hito.contrato.condicionesPagoDias} días.`,
            '/proveedor/pagos',
          );
        }
      }
    }

    return actualizado;
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
