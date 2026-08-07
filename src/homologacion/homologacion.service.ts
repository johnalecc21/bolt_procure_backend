import { Injectable, NotFoundException } from '@nestjs/common';
import { EstadoDocumento, EstadoHomologacion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';

@Injectable()
export class HomologacionService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  private async proveedorIdForUser(userId: string) {
    const profile = await this.prisma.proveedorProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('No tienes un perfil de proveedor asociado.');
    return profile.id;
  }

  async mine(userId: string) {
    const proveedorId = await this.proveedorIdForUser(userId);
    const homologacion = await this.prisma.homologacion.findUnique({
      where: { proveedorId },
      include: { documentos: true },
    });
    if (!homologacion) throw new NotFoundException('Aún no has iniciado tu homologación.');
    return homologacion;
  }

  async subirDocumento(userId: string, documentoId: string) {
    const proveedorId = await this.proveedorIdForUser(userId);
    const doc = await this.prisma.documentoHomologacion.findFirst({
      where: { id: documentoId, homologacion: { proveedorId } },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    return this.prisma.documentoHomologacion.update({
      where: { id: documentoId },
      data: { estado: EstadoDocumento.SUBIDO },
    });
  }

  async enviar(userId: string) {
    const proveedorId = await this.proveedorIdForUser(userId);
    return this.prisma.homologacion.update({
      where: { proveedorId },
      data: { estado: EstadoHomologacion.EN_REVISION, fechaSolicitud: new Date() },
    });
  }

  cola() {
    return this.prisma.homologacion.findMany({
      where: { estado: { in: [EstadoHomologacion.EN_REVISION, EstadoHomologacion.ZONA_GRIS] } },
      include: { documentos: true, proveedor: true },
    });
  }

  async resolver(
    proveedorId: string,
    estado: 'APROBADO' | 'RECHAZADO',
    score: number,
    actorNombre: string,
    motivo?: string,
  ) {
    const homologacion = await this.prisma.homologacion.findUnique({
      where: { proveedorId },
      include: { proveedor: true },
    });
    if (!homologacion) throw new NotFoundException('Homologación no encontrada.');

    await this.prisma.homologacion.update({
      where: { proveedorId },
      data: {
        estado: estado as EstadoHomologacion,
        score,
        proximaRevalidacion: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      },
    });
    if (estado === 'APROBADO') {
      await this.prisma.proveedorProfile.update({ where: { id: proveedorId }, data: { score } });
    }
    await this.auditLog.log({
      usuario: actorNombre,
      accion: estado === 'APROBADO' ? 'Homologación aprobada' : 'Homologación rechazada',
      detalle: homologacion.proveedor.nombre,
      motivo,
    });
    return { ok: true };
  }
}
