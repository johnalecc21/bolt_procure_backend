import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EstadoHomologacion, EstadoRequerimiento, Prisma, Role, TipoAprobacion, TipoRegla } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { CreateRequerimientoDto } from './dto/create-requerimiento.dto';

@Injectable()
export class RequerimientosService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private notificaciones: NotificacionesService,
  ) {}

  // Notifies whoever can act right now: for UNICA that's everyone in the
  // role list (any one of them can resolve it); for SECUENCIAL only the
  // role at the current step, since the rest haven't got a turn yet.
  async notificarAprobadores(
    companyId: string,
    rolesRequeridos: Role[],
    tipoRegla: TipoRegla,
    pasoActual: number,
    tituloRequerimiento: string,
    monto: number,
  ) {
    const roles = tipoRegla === TipoRegla.SECUENCIAL ? [rolesRequeridos[pasoActual]] : rolesRequeridos;
    if (!roles.length) return;
    const memberships = await this.prisma.companyMembership.findMany({
      where: { companyId, activo: true, user: { role: { in: roles }, activo: true } },
      include: { user: true },
    });
    await Promise.all(
      memberships.map((m) =>
        this.notificaciones.create(
          m.user.id,
          'APROBACION',
          'Aprobación pendiente',
          `"${tituloRequerimiento}" ($${monto.toLocaleString('es-CO')}) necesita tu aprobación.`,
        ),
      ),
    );
  }

  // Defense in depth: the directory UI only lists approved providers, but the
  // endpoints below can be called directly, so re-check eligibility here
  // regardless of what was sent.
  private async filtrarElegibles(proveedorIds: string[]) {
    const candidatos = await this.prisma.proveedorProfile.findMany({
      where: { id: { in: proveedorIds } },
      include: { homologacion: true },
    });
    return {
      elegibles: candidatos.filter((p) => p.homologacion?.estado === EstadoHomologacion.APROBADO),
      excluidos: candidatos.filter((p) => p.homologacion?.estado !== EstadoHomologacion.APROBADO),
    };
  }

  async list(companyId: string, userId: string, role: Role) {
    return this.prisma.requerimiento.findMany({
      where: {
        companyId,
        ...(role === Role.COMPRADOR ? { solicitanteId: userId } : {}),
      },
      include: { solicitante: { select: { nombre: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(companyId: string, id: string) {
    const req = await this.prisma.requerimiento.findFirst({
      where: { id, companyId },
      include: {
        solicitante: { select: { nombre: true } },
        comentarios: { orderBy: { createdAt: 'desc' } },
        documentos: true,
        adjudicacion: true,
        ofertas: { include: { proveedor: true } },
        aprobaciones: {
          orderBy: { createdAt: 'asc' },
          include: {
            resueltoPor: { select: { nombre: true } },
            pasos: {
              orderBy: { aprobadoAt: 'asc' },
              include: { aprobadoPor: { select: { nombre: true } } },
            },
          },
        },
      },
    });
    if (!req) throw new NotFoundException('Requerimiento no encontrado.');
    return req;
  }

  async create(companyId: string, solicitanteId: string, dto: CreateRequerimientoDto) {
    const { elegibles, excluidos } = dto.proveedorIds?.length
      ? await this.filtrarElegibles(dto.proveedorIds)
      : { elegibles: [], excluidos: [] };

    let rolesRequeridosCreados: Role[] = [];
    let tipoReglaCreado: TipoRegla = TipoRegla.UNICA;

    const requerimiento = await this.prisma.$transaction(async (tx) => {
      const requerimiento = await tx.requerimiento.create({
        data: {
          companyId,
          solicitanteId,
          titulo: dto.titulo,
          descripcion: dto.descripcion,
          categoria: dto.categoria,
          montoEstimado: dto.montoEstimado,
          fechaLimite: new Date(dto.fechaLimite),
          criteriosPeso: dto.criteriosPeso,
          especificaciones: dto.especificaciones as unknown as Prisma.InputJsonValue,
          estado: EstadoRequerimiento.PENDIENTE_APROBACION,
        },
      });
      // Every new requerimiento needs a green light before it can go out to
      // tender. Who can grant it is decided by the company's Matriz de
      // Aprobación — the rule matching the monto is snapshotted onto the
      // aprobacion so a later matrix edit doesn't retroactively change who
      // was authorized to approve an already-pending request.
      const reglas = await tx.matrizAprobacionRegla.findMany({
        where: { companyId },
        orderBy: { montoMin: 'asc' },
      });
      const regla = reglas.find(
        (r) => dto.montoEstimado >= r.montoMin && (r.montoMax == null || dto.montoEstimado <= r.montoMax),
      );
      const rolesRequeridos = regla && regla.roles.length > 0
        ? regla.roles
        : [Role.ADMIN_CLIENTE, Role.APROBADOR_CFO];
      rolesRequeridosCreados = rolesRequeridos;
      tipoReglaCreado = regla?.tipo ?? TipoRegla.UNICA;
      await tx.aprobacion.create({
        data: {
          requerimientoId: requerimiento.id,
          tipo: TipoAprobacion.SALIDA_LICITACION,
          monto: dto.montoEstimado,
          urgente: false,
          rolesRequeridos,
          tipoRegla: tipoReglaCreado,
        },
      });
      // The shortlist chosen while drafting is staged, not sent — providers
      // only find out once the requerimiento actually clears approval.
      if (elegibles.length > 0) {
        await tx.invitacion.createMany({
          data: elegibles.map((p) => ({
            companyId,
            proveedorId: p.id,
            requerimientoId: requerimiento.id,
            categoria: dto.categoria,
            fechaLimite: new Date(dto.fechaLimite),
            enviada: false,
          })),
        });
      }
      return requerimiento;
    });

    await this.notificarAprobadores(
      companyId,
      rolesRequeridosCreados,
      tipoReglaCreado,
      0,
      requerimiento.titulo,
      requerimiento.montoEstimado,
    );

    return { ...requerimiento, excluidosPorHomologacion: excluidos.map((p) => ({ id: p.id, nombre: p.nombre })) };
  }

  async updateEstado(companyId: string, id: string, estado: EstadoRequerimiento, actorNombre: string) {
    await this.findOne(companyId, id);
    const updated = await this.prisma.requerimiento.update({ where: { id }, data: { estado } });
    await this.auditLog.log({
      usuario: actorNombre,
      accion: 'Cambio de estado de requerimiento',
      detalle: `${id} → ${estado}`,
    });
    return updated;
  }

  async extenderPlazo(companyId: string, id: string, dias: number, actorNombre: string, motivo?: string) {
    const req = await this.findOne(companyId, id);
    const nuevaFecha = new Date(req.fechaLimite);
    nuevaFecha.setDate(nuevaFecha.getDate() + dias);
    const updated = await this.prisma.requerimiento.update({ where: { id }, data: { fechaLimite: nuevaFecha } });
    await this.auditLog.log({
      usuario: actorNombre,
      accion: 'Plazo de licitación extendido',
      detalle: `${id} +${dias} día(s)${motivo ? ` — ${motivo}` : ''}`,
    });
    return updated;
  }

  async addComment(companyId: string, id: string, autor: string, texto: string) {
    await this.findOne(companyId, id);
    return this.prisma.comentarioRequerimiento.create({
      data: { requerimientoId: id, autor, texto },
    });
  }

  async addDocumento(companyId: string, id: string, nombre: string) {
    await this.findOne(companyId, id);
    return this.prisma.documentoRequerimiento.create({ data: { requerimientoId: id, nombre } });
  }

  // Adds providers beyond the shortlist chosen at creation — used any time
  // after a requerimiento is out, so invitations here are sent immediately.
  async invitarProveedores(companyId: string, id: string, proveedorIds: string[]) {
    const req = await this.findOne(companyId, id);
    const existentes = await this.prisma.invitacion.findMany({
      where: { requerimientoId: id, proveedorId: { in: proveedorIds } },
      select: { proveedorId: true },
    });
    const yaInvitados = new Set(existentes.map((i) => i.proveedorId));

    const { elegibles: elegiblesTodos, excluidos } = await this.filtrarElegibles(proveedorIds);
    const elegibles = elegiblesTodos.filter((p) => !yaInvitados.has(p.id));
    if (elegibles.length === 0 && excluidos.length === 0) {
      throw new BadRequestException('Los proveedores seleccionados ya fueron invitados a este proceso.');
    }
    if (elegibles.length === 0) {
      throw new BadRequestException('Ninguno de los proveedores seleccionados tiene homologación aprobada.');
    }

    await this.prisma.$transaction([
      this.prisma.invitacion.createMany({
        data: elegibles.map((p) => ({
          companyId,
          proveedorId: p.id,
          requerimientoId: id,
          categoria: req.categoria,
          fechaLimite: req.fechaLimite,
          enviada: true,
        })),
      }),
      this.prisma.requerimiento.update({
        where: { id },
        data: {
          proveedoresInvitados: { increment: elegibles.length },
          estado: EstadoRequerimiento.EN_LICITACION,
        },
      }),
    ]);

    const elegiblesConUser = await this.prisma.proveedorProfile.findMany({
      where: { id: { in: elegibles.map((p) => p.id) } },
      include: { user: true },
    });
    await Promise.all(
      elegiblesConUser
        .filter((p) => p.user)
        .map((p) =>
          this.notificaciones.create(
            p.user!.id,
            'PROVEEDOR',
            'Nueva invitación a licitar',
            `Fuiste invitado a participar en "${req.titulo}".`,
          ),
        ),
    );

    const actualizado = await this.findOne(companyId, id);
    return {
      ...actualizado,
      excluidosPorHomologacion: excluidos.map((p) => ({ id: p.id, nombre: p.nombre })),
    };
  }
}
