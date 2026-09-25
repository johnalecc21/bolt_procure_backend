import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Portal } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { ProveedoresService } from '../proveedores/proveedores.service';
import type { AuthenticatedUser } from '../auth/types';

@Injectable()
export class PreguntasService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private notificaciones: NotificacionesService,
    private proveedores: ProveedoresService,
  ) {}

  // Proveedor sees only their own questions on this proceso; Cliente sees every
  // question asked by any proveedor, scoped to their company.
  async list(user: AuthenticatedUser, requerimientoId: string) {
    if (user.portal === Portal.PROVEEDOR) {
      const proveedorId = await this.proveedores.findIdForUser(user.sub);
      return this.prisma.pregunta.findMany({
        where: { requerimientoId, proveedorId },
        orderBy: { createdAt: 'desc' },
      });
    }
    return this.prisma.pregunta.findMany({
      where: { requerimientoId, requerimiento: { companyId: user.companyId } },
      include: { proveedor: { select: { nombre: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async preguntar(userId: string, requerimientoId: string, texto: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    // Only a proveedor actually invited to this proceso can ask about it.
    const invitado = await this.prisma.invitacion.findFirst({
      where: { requerimientoId, proveedorId, enviada: true },
    });
    if (!invitado) {
      throw new ForbiddenException('No tienes una invitación activa para este proceso.');
    }

    const pregunta = await this.prisma.pregunta.create({
      data: { requerimientoId, proveedorId, pregunta: texto },
    });

    const req = await this.prisma.requerimiento.findUnique({
      where: { id: requerimientoId },
      select: { titulo: true, solicitanteId: true },
    });
    if (req) {
      await this.notificaciones.create(
        req.solicitanteId,
        'PROVEEDOR',
        'Nueva pregunta de un proveedor',
        `Un proveedor preguntó sobre "${req.titulo}".`,
        `/cliente/licitaciones/${requerimientoId}`,
      );
    }
    return pregunta;
  }

  async responder(companyId: string, actorId: string, actorNombre: string, preguntaId: string, respuesta: string) {
    const pregunta = await this.prisma.pregunta.findFirst({
      where: { id: preguntaId, requerimiento: { companyId } },
      include: {
        requerimiento: { select: { titulo: true } },
        proveedor: { include: { user: true } },
      },
    });
    if (!pregunta) throw new NotFoundException('Pregunta no encontrada.');
    if (pregunta.respuesta) throw new ForbiddenException('Esta pregunta ya fue respondida.');

    const actualizada = await this.prisma.pregunta.update({
      where: { id: preguntaId },
      data: { respuesta, respondidoPorId: actorId, respondidoAt: new Date() },
    });

    await this.auditLog.log({
      companyId,
      usuario: actorNombre,
      accion: 'Pregunta respondida',
      detalle: `${pregunta.requerimiento.titulo}: ${pregunta.pregunta}`,
    });

    if (pregunta.proveedor.user) {
      await this.notificaciones.create(
        pregunta.proveedor.user.id,
        'PROVEEDOR',
        'Tu pregunta fue respondida',
        `"${pregunta.requerimiento.titulo}": ${respuesta.length > 120 ? `${respuesta.slice(0, 120)}…` : respuesta}`,
        `/proveedor/ofertas/${pregunta.requerimientoId}`,
      );
    }
    return actualizada;
  }
}
