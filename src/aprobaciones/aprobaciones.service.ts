import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EstadoAprobacion, EstadoRequerimiento, Role, TipoAprobacion, TipoRegla } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';

@Injectable()
export class AprobacionesService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private notificaciones: NotificacionesService,
  ) {}

  // Sends the shortlist staged at creation time (Invitacion rows with
  // enviada:false) once the requerimiento clears approval — this is the
  // moment providers actually find out they were invited.
  private async enviarInvitacionesPendientes(requerimientoId: string, tituloRequerimiento: string) {
    const pendientes = await this.prisma.invitacion.findMany({
      where: { requerimientoId, enviada: false },
      include: { proveedor: { include: { user: true } } },
    });
    if (pendientes.length === 0) return;

    await this.prisma.$transaction([
      this.prisma.invitacion.updateMany({
        where: { id: { in: pendientes.map((i) => i.id) } },
        data: { enviada: true },
      }),
      this.prisma.requerimiento.update({
        where: { id: requerimientoId },
        data: { proveedoresInvitados: { increment: pendientes.length } },
      }),
    ]);

    await Promise.all(
      pendientes
        .filter((i) => i.proveedor.user)
        .map((i) =>
          this.notificaciones.create(
            i.proveedor.user!.id,
            'PROVEEDOR',
            'Nueva invitación a licitar',
            `Fuiste invitado a participar en "${tituloRequerimiento}".`,
          ),
        ),
    );
  }

  // Matches the Matriz de Aprobación semantics: UNICA resolves as soon as
  // ANY of the required roles approves; SECUENCIAL requires each required
  // role to approve in order, so only the role at the current step qualifies.
  private esElegible(
    aprobacion: { tipoRegla: TipoRegla; rolesRequeridos: Role[]; pasoActual: number },
    role: Role,
  ) {
    if (aprobacion.tipoRegla === TipoRegla.SECUENCIAL) {
      return aprobacion.rolesRequeridos[aprobacion.pasoActual] === role;
    }
    return aprobacion.rolesRequeridos.includes(role);
  }

  async list(companyId: string, role: Role) {
    const items = await this.prisma.aprobacion.findMany({
      where: { estado: EstadoAprobacion.PENDIENTE, requerimiento: { companyId } },
      include: {
        requerimiento: { select: { titulo: true, solicitante: { select: { nombre: true } } } },
      },
      orderBy: [{ urgente: 'desc' }, { createdAt: 'asc' }],
    });
    return items.filter((a) => this.esElegible(a, role));
  }

  private async find(companyId: string, id: string) {
    const aprobacion = await this.prisma.aprobacion.findFirst({
      where: { id, requerimiento: { companyId } },
      include: { requerimiento: true },
    });
    if (!aprobacion) throw new NotFoundException('Aprobación no encontrada.');
    return aprobacion;
  }

  async aprobar(companyId: string, id: string, resueltoPorId: string, resueltoPorRole: Role, actorNombre: string) {
    const aprobacion = await this.find(companyId, id);
    if (aprobacion.estado !== EstadoAprobacion.PENDIENTE) {
      throw new ForbiddenException('Esta aprobación ya fue resuelta.');
    }
    if (!this.esElegible(aprobacion, resueltoPorRole)) {
      throw new ForbiddenException('Tu rol no está autorizado para aprobar esta solicitud según la Matriz de Aprobación.');
    }

    const esUltimoPaso =
      aprobacion.tipoRegla !== TipoRegla.SECUENCIAL ||
      aprobacion.pasoActual >= aprobacion.rolesRequeridos.length - 1;

    if (esUltimoPaso) {
      await this.prisma.$transaction([
        this.prisma.aprobacionPaso.create({
          data: { aprobacionId: id, rol: resueltoPorRole, aprobadoPorId: resueltoPorId },
        }),
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
      if (aprobacion.tipo === TipoAprobacion.SALIDA_LICITACION) {
        await this.enviarInvitacionesPendientes(aprobacion.requerimientoId, aprobacion.requerimiento.titulo);
      }
    } else {
      await this.prisma.$transaction([
        this.prisma.aprobacionPaso.create({
          data: { aprobacionId: id, rol: resueltoPorRole, aprobadoPorId: resueltoPorId },
        }),
        this.prisma.aprobacion.update({
          where: { id },
          data: { pasoActual: { increment: 1 } },
        }),
      ]);
      await this.auditLog.log({
        usuarioId: resueltoPorId,
        usuario: actorNombre,
        accion: 'Aprobación (paso intermedio)',
        detalle: `${aprobacion.requerimiento.titulo} — paso ${aprobacion.pasoActual + 1} de ${aprobacion.rolesRequeridos.length}`,
      });
    }
    return { ok: true };
  }

  async rechazar(
    companyId: string,
    id: string,
    resueltoPorId: string,
    resueltoPorRole: Role,
    actorNombre: string,
    motivo: string,
  ) {
    const aprobacion = await this.find(companyId, id);
    if (aprobacion.estado !== EstadoAprobacion.PENDIENTE) {
      throw new ForbiddenException('Esta aprobación ya fue resuelta.');
    }
    if (!this.esElegible(aprobacion, resueltoPorRole)) {
      throw new ForbiddenException('Tu rol no está autorizado para rechazar esta solicitud según la Matriz de Aprobación.');
    }
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
