import { Injectable, NotFoundException } from '@nestjs/common';
import { EstadoAprobacion, EstadoRequerimiento } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';

@Injectable()
export class AprobacionesService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  list(companyId: string) {
    return this.prisma.aprobacion.findMany({
      where: { estado: EstadoAprobacion.PENDIENTE, requerimiento: { companyId } },
      include: {
        requerimiento: { select: { titulo: true, solicitante: { select: { nombre: true } } } },
      },
      orderBy: [{ urgente: 'desc' }, { createdAt: 'asc' }],
    });
  }

  private async find(companyId: string, id: string) {
    const aprobacion = await this.prisma.aprobacion.findFirst({
      where: { id, requerimiento: { companyId } },
      include: { requerimiento: true },
    });
    if (!aprobacion) throw new NotFoundException('Aprobación no encontrada.');
    return aprobacion;
  }

  async aprobar(companyId: string, id: string, resueltoPorId: string, actorNombre: string) {
    const aprobacion = await this.find(companyId, id);
    await this.prisma.$transaction([
      this.prisma.aprobacion.update({
        where: { id },
        data: { estado: EstadoAprobacion.APROBADA, resueltoPorId, resueltoAt: new Date() },
      }),
      this.prisma.requerimiento.update({
        where: { id: aprobacion.requerimientoId },
        data: { estado: EstadoRequerimiento.EN_LICITACION },
      }),
    ]);
    await this.auditLog.log({
      usuarioId: resueltoPorId,
      usuario: actorNombre,
      accion: 'Aprobación',
      detalle: aprobacion.requerimiento.titulo,
    });
    return { ok: true };
  }

  async rechazar(
    companyId: string,
    id: string,
    resueltoPorId: string,
    actorNombre: string,
    motivo: string,
  ) {
    const aprobacion = await this.find(companyId, id);
    await this.prisma.aprobacion.update({
      where: { id },
      data: {
        estado: EstadoAprobacion.RECHAZADA,
        resueltoPorId,
        resueltoAt: new Date(),
        motivoRechazo: motivo,
      },
    });
    await this.auditLog.log({
      usuarioId: resueltoPorId,
      usuario: actorNombre,
      accion: 'Rechazo',
      detalle: aprobacion.requerimiento.titulo,
      motivo,
    });
    return { ok: true };
  }
}
