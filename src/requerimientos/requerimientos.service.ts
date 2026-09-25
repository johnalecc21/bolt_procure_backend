import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EstadoDocumento,
  EstadoHomologacion,
  EstadoRequerimiento,
  Prisma,
  Role,
  TipoAprobacion,
  TipoRegla,
  Moneda,
  PrioridadRequerimiento,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { StorageService } from '../storage/storage.service';
import { formatRequerimientoCodigo } from '../common/utils/codigo.util';
import { CreateRequerimientoDto } from './dto/create-requerimiento.dto';
import { ReenviarRequerimientoDto } from './dto/reenviar-requerimiento.dto';
import {
  categoriasFaltantes,
  esElegible,
} from '../homologacion/requisitos.util';
import { formatMonto } from '../common/utils/moneda.util';
import { finDelDia } from '../common/utils/fecha.util';

import { PlanesService } from '../planes/planes.service';
import { EstructuraService } from '../estructura/estructura.service';
import { paginate } from '../common/dto/pagination.dto';
const BUCKET = 'requerimientos-documentos';

// Manual transitions allowed via PATCH /:id/estado. Every other state change
// happens as a side effect of a real action that builds its own records:
// approval (→ EN_LICITACION), starting a negotiation round (→ EN_NEGOCIACION),
// confirming the adjudicación (→ ADJUDICADO), signing (→ EN_CUMPLIMIENTO),
// completing every milestone (→ CERRADO) and a rejection (→ BORRADOR, fixed
// and resent with reenviar()). The only manual step left is closing a
// contract early from Seguimiento.
const TRANSICIONES_MANUALES_PERMITIDAS: Partial<
  Record<EstadoRequerimiento, EstadoRequerimiento[]>
> = {
  [EstadoRequerimiento.EN_CUMPLIMIENTO]: [EstadoRequerimiento.CERRADO],
};

@Injectable()
export class RequerimientosService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private notificaciones: NotificacionesService,
    private storage: StorageService,
    private planes: PlanesService,
    private estructura: EstructuraService,
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
    aprobacionId: string,
    moneda: Moneda = Moneda.USD,
  ) {
    const roles =
      tipoRegla === TipoRegla.SECUENCIAL
        ? [rolesRequeridos[pasoActual]]
        : rolesRequeridos;
    if (!roles.length) return;
    const memberships = await this.prisma.companyMembership.findMany({
      where: {
        companyId,
        activo: true,
        user: { role: { in: roles }, activo: true },
      },
      include: { user: true },
    });
    await Promise.all(
      memberships.map((m) =>
        this.notificaciones.create(
          m.user.id,
          'APROBACION',
          'Aprobación pendiente',
          `"${tituloRequerimiento}" (${formatMonto(monto, moneda)}) necesita tu aprobación.`,
          `/cliente/aprobaciones?highlight=${aprobacionId}`,
        ),
      ),
    );
  }

  // Defense in depth: the directory UI only lists approved providers, but the
  // endpoints below can be called directly, so re-check eligibility here
  // regardless of what was sent.
  /**
   * Splits candidates into invitable and excluded: an APROBADO homologación
   * plus every document category this company requires (VALIDADO, unexpired).
   */
  private async filtrarElegibles(companyId: string, proveedorIds: string[]) {
    const [company, candidatos] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { categoriasHomologacionRequeridas: true },
      }),
      this.prisma.proveedorProfile.findMany({
        where: { id: { in: proveedorIds } },
        include: { homologacion: { include: { documentos: true } } },
      }),
    ]);
    const requeridas = company.categoriasHomologacionRequeridas;
    const elegibles = candidatos.filter((p) =>
      esElegible(p.homologacion, requeridas),
    );
    const excluidos = candidatos
      .filter((p) => !esElegible(p.homologacion, requeridas))
      .map((p) => ({
        id: p.id,
        nombre: p.nombre,
        motivo:
          p.homologacion?.estado !== EstadoHomologacion.APROBADO
            ? 'Homologación no aprobada'
            : `Faltan documentos validados: ${categoriasFaltantes(p.homologacion, requeridas).join(', ')}`,
      }));
    return { elegibles, excluidos };
  }

  async list(companyId: string, userId: string, role: Role) {
    return this.prisma.requerimiento.findMany({
      where: {
        companyId,
        ...(role === Role.COMPRADOR ? { solicitanteId: userId } : {}),
      },
      include: { solicitante: { select: { nombre: true } } },
      orderBy: { createdAt: 'desc' },
      // Dashboard/table screens filter this client-side, so it isn't
      // page-paginated — this is a growth guard-rail, not a page size.
      take: 200,
    });
  }

  /** Server-side paginated list for the Requerimientos screen (search, state, cost center). */
  async listPaginada(
    companyId: string,
    userId: string,
    role: Role,
    params: {
      page: number;
      limit: number;
      q?: string;
      estado?: EstadoRequerimiento;
      centroCostoId?: string;
    },
  ) {
    const q = params.q?.trim();
    const numero = q?.match(/^(?:REQ-)?0*(\d+)$/i)?.[1];
    const where: Prisma.RequerimientoWhereInput = {
      companyId,
      ...(role === Role.COMPRADOR ? { solicitanteId: userId } : {}),
      ...(params.estado ? { estado: params.estado } : {}),
      ...(params.centroCostoId ? { centroCostoId: params.centroCostoId } : {}),
      ...(q
        ? {
            OR: [
              { titulo: { contains: q, mode: 'insensitive' } },
              { categoria: { contains: q, mode: 'insensitive' } },
              ...(numero ? [{ numero: Number(numero) }] : []),
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.requerimiento.findMany({
        where,
        include: {
          solicitante: { select: { nombre: true } },
          centroCosto: { select: { codigo: true, nombre: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.requerimiento.count({ where }),
    ]);
    return paginate(items, total, params.page, params.limit);
  }

  async findOne(companyId: string, id: string) {
    const req = await this.prisma.requerimiento.findFirst({
      where: { id, companyId },
      include: {
        solicitante: { select: { nombre: true } },
        comentarios: { orderBy: { createdAt: 'desc' } },
        documentos: true,
        adjudicaciones: { include: { proveedor: { select: { nombre: true } } } },
        items: { orderBy: { orden: 'asc' } },
        ofertas: { include: { proveedor: true } },
        invitaciones: {
          where: { enviada: true },
          include: { proveedor: true },
        },
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

  /**
   * Every requerimiento needs a green light before it can go out to tender.
   * Who can grant it is decided by the company's Matriz de Aprobación — the
   * rule matching the monto is snapshotted onto the aprobación so a later
   * matrix edit doesn't retroactively change who was authorized to approve an
   * already-pending request. Used on creation and on resubmission.
   */
  private async crearAprobacion(
    tx: Prisma.TransactionClient,
    companyId: string,
    requerimientoId: string,
    monto: number,
    excedePresupuesto: boolean,
    urgente = false,
  ) {
    const reglas = await tx.matrizAprobacionRegla.findMany({
      where: { companyId },
      orderBy: { montoMin: 'asc' },
    });
    const regla = reglas.find(
      (r) => monto >= r.montoMin && (r.montoMax == null || monto <= r.montoMax),
    );
    const rolesBase =
      regla && regla.roles.length > 0
        ? regla.roles
        : [Role.ADMIN_CLIENTE, Role.APROBADOR_CFO];
    const rolesRequeridos =
      excedePresupuesto && !rolesBase.includes(Role.APROBADOR_CFO)
        ? [...rolesBase, Role.APROBADOR_CFO]
        : rolesBase;
    const tipoRegla = regla?.tipo ?? TipoRegla.UNICA;
    const aprobacion = await tx.aprobacion.create({
      data: {
        requerimientoId,
        tipo: excedePresupuesto
          ? TipoAprobacion.EXCEPCION_PRESUPUESTO
          : TipoAprobacion.SALIDA_LICITACION,
        monto,
        urgente,
        rolesRequeridos,
        tipoRegla,
      },
    });
    return { rolesRequeridos, tipoRegla, aprobacionId: aprobacion.id };
  }

  async create(
    companyId: string,
    solicitanteId: string,
    dto: CreateRequerimientoDto,
  ) {
    await this.planes.verificarRequerimientoDelMes(companyId);
    const { elegibles, excluidos } = dto.proveedorIds?.length
      ? await this.filtrarElegibles(companyId, dto.proveedorIds)
      : { elegibles: [], excluidos: [] };

    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { monedaBase: true, pais: true },
    });
    const fechaLimite = finDelDia(dto.fechaLimite, company.pais);
    if (fechaLimite <= new Date()) {
      throw new BadRequestException('La fecha límite de la licitación debe ser futura.');
    }
    const moneda = dto.moneda ?? company.monedaBase;
    // Over the cost center's remaining budget → it still goes to approval,
    // but as a budget exception that finance (CFO) must sign off on.
    const { centroCostoId, evaluacion: presupuesto } =
      await this.estructura.evaluarParaRequerimiento(
        companyId,
        dto.centroCostoId,
        dto.montoEstimado,
        moneda,
      );
    const excedePresupuesto = presupuesto?.excede ?? false;

    let rolesRequeridosCreados: Role[] = [];
    let tipoReglaCreado: TipoRegla = TipoRegla.UNICA;
    let aprobacionIdCreada = '';

    const requerimiento = await this.prisma.$transaction(async (tx) => {
      const requerimiento = await tx.requerimiento.create({
        data: {
          companyId,
          solicitanteId,
          titulo: dto.titulo,
          descripcion: dto.descripcion,
          categoria: dto.categoria,
          montoEstimado: dto.montoEstimado,
          moneda,
          centroCostoId,
          fechaLimite,
          abiertoRed: dto.abiertoRed ?? false,
          criteriosPeso: dto.criteriosPeso,
          especificaciones:
            dto.especificaciones as unknown as Prisma.InputJsonValue,
          estado: EstadoRequerimiento.PENDIENTE_APROBACION,
          prioridad: dto.prioridad,
          items: dto.items?.length
            ? {
                create: dto.items.map((item, orden) => ({
                  orden,
                  descripcion: item.descripcion.trim(),
                  cantidad: item.cantidad,
                  unidad: item.unidad.trim(),
                  especificacion: item.especificacion?.trim() || null,
                })),
              }
            : undefined,
        },
      });
      const creada = await this.crearAprobacion(
        tx,
        companyId,
        requerimiento.id,
        dto.montoEstimado,
        excedePresupuesto,
        dto.prioridad === PrioridadRequerimiento.URGENTE,
      );
      rolesRequeridosCreados = creada.rolesRequeridos;
      tipoReglaCreado = creada.tipoRegla;
      aprobacionIdCreada = creada.aprobacionId;
      // The shortlist chosen while drafting is staged, not sent — providers
      // only find out once the requerimiento actually clears approval.
      if (elegibles.length > 0) {
        await tx.invitacion.createMany({
          data: elegibles.map((p) => ({
            companyId,
            proveedorId: p.id,
            requerimientoId: requerimiento.id,
            categoria: dto.categoria,
            fechaLimite,
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
      aprobacionIdCreada,
      requerimiento.moneda,
    );

    if (excedePresupuesto && presupuesto) {
      await this.auditLog.log({
        companyId,
        usuarioId: solicitanteId,
        usuario: 'Control de presupuesto',
        accion: 'Requerimiento excede el presupuesto del centro de costo',
        detalle: `${formatRequerimientoCodigo(requerimiento.numero)} — ${presupuesto.centroCosto}: disponible ${formatMonto(presupuesto.disponible, presupuesto.moneda)}, solicitado ${formatMonto(dto.montoEstimado, moneda)}`,
      });
    }

    return {
      ...requerimiento,
      excluidosPorHomologacion: excluidos,
      presupuesto,
    };
  }

  async updateEstado(
    companyId: string,
    id: string,
    estado: EstadoRequerimiento,
    actorNombre: string,
  ) {
    const actual = await this.findOne(companyId, id);
    const permitidos = TRANSICIONES_MANUALES_PERMITIDAS[actual.estado] ?? [];
    if (!permitidos.includes(estado)) {
      throw new BadRequestException(
        `No se puede pasar de ${actual.estado} a ${estado} directamente.`,
      );
    }
    const updated = await this.prisma.requerimiento.update({
      where: { id },
      data: { estado },
    });
    await this.auditLog.log({
      companyId,
      usuario: actorNombre,
      accion: 'Cambio de estado de requerimiento',
      detalle: `${formatRequerimientoCodigo(updated.numero)} → ${estado}`,
    });
    return updated;
  }

  /** Moves the tender's deadline — the proveedores' invitations carry their own copy, kept in sync. */
  async extenderPlazo(
    companyId: string,
    id: string,
    dias: number,
    actorNombre: string,
    motivo?: string,
  ) {
    const req = await this.findOne(companyId, id);
    if (req.estado !== EstadoRequerimiento.EN_LICITACION) {
      throw new BadRequestException(
        'Solo se puede extender el plazo de una licitación en curso.',
      );
    }
    // Extending an already-expired tender counts from today, not from the past date.
    const nuevaFecha = new Date(
      Math.max(req.fechaLimite.getTime(), Date.now()),
    );
    nuevaFecha.setDate(nuevaFecha.getDate() + dias);
    const [updated] = await this.prisma.$transaction([
      this.prisma.requerimiento.update({
        where: { id },
        data: { fechaLimite: nuevaFecha },
      }),
      this.prisma.invitacion.updateMany({
        where: { requerimientoId: id },
        data: { fechaLimite: nuevaFecha },
      }),
    ]);
    await this.auditLog.log({
      companyId,
      usuario: actorNombre,
      accion: 'Plazo de licitación extendido',
      detalle: `${formatRequerimientoCodigo(updated.numero)} +${dias} día(s)${motivo ? ` — ${motivo}` : ''}`,
    });
    return updated;
  }

  /** Ends the tender now: from this moment the API rejects new or edited offers. */
  async cerrarLicitacion(companyId: string, id: string, actorNombre: string) {
    const req = await this.findOne(companyId, id);
    if (req.estado !== EstadoRequerimiento.EN_LICITACION) {
      throw new BadRequestException('Esta licitación no está en curso.');
    }
    const ahora = new Date();
    if (req.fechaLimite <= ahora) return req;
    const [updated] = await this.prisma.$transaction([
      this.prisma.requerimiento.update({
        where: { id },
        data: { fechaLimite: ahora },
      }),
      this.prisma.invitacion.updateMany({
        where: { requerimientoId: id },
        data: { fechaLimite: ahora },
      }),
    ]);
    await this.auditLog.log({
      companyId,
      usuario: actorNombre,
      accion: 'Licitación cerrada anticipadamente',
      detalle: formatRequerimientoCodigo(updated.numero),
    });
    return updated;
  }

  /**
   * After a rejection the requerimiento goes back to BORRADOR: the solicitante
   * corrects what the approver objected to and sends it again, which runs the
   * approval matrix and budget check from scratch on the new values.
   */
  async reenviar(
    companyId: string,
    id: string,
    actorId: string,
    actorNombre: string,
    dto: ReenviarRequerimientoDto,
  ) {
    const req = await this.findOne(companyId, id);
    if (req.estado !== EstadoRequerimiento.BORRADOR) {
      throw new ConflictException(
        'Solo se puede reenviar un requerimiento devuelto a borrador.',
      );
    }
    const { pais } = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { pais: true },
    });
    const fechaLimite = dto.fechaLimite
      ? finDelDia(dto.fechaLimite, pais)
      : req.fechaLimite;
    if (fechaLimite <= new Date()) {
      throw new BadRequestException(
        'La fecha límite de la licitación debe ser futura.',
      );
    }
    const montoEstimado = dto.montoEstimado ?? req.montoEstimado;
    const prioridad = dto.prioridad ?? req.prioridad;
    const { centroCostoId, evaluacion: presupuesto } =
      await this.estructura.evaluarParaRequerimiento(
        companyId,
        dto.centroCostoId ?? req.centroCostoId ?? undefined,
        montoEstimado,
        req.moneda,
      );
    const excedePresupuesto = presupuesto?.excede ?? false;

    const { updated, creada } = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.requerimiento.update({
        where: { id },
        data: {
          titulo: dto.titulo ?? req.titulo,
          descripcion: dto.descripcion ?? req.descripcion,
          montoEstimado,
          fechaLimite,
          centroCostoId,
          prioridad,
          estado: EstadoRequerimiento.PENDIENTE_APROBACION,
        },
      });
      // Still a draft with no offers, so the lines can be replaced wholesale.
      if (dto.items) {
        await tx.itemRequerimiento.deleteMany({ where: { requerimientoId: id } });
        if (dto.items.length) {
          await tx.itemRequerimiento.createMany({
            data: dto.items.map((item, orden) => ({
              requerimientoId: id,
              orden,
              descripcion: item.descripcion.trim(),
              cantidad: item.cantidad,
              unidad: item.unidad.trim(),
              especificacion: item.especificacion?.trim() || null,
            })),
          });
        }
      }
      await tx.invitacion.updateMany({
        where: { requerimientoId: id, enviada: false },
        data: { fechaLimite },
      });
      const creada = await this.crearAprobacion(
        tx,
        companyId,
        id,
        montoEstimado,
        excedePresupuesto,
        prioridad === PrioridadRequerimiento.URGENTE,
      );
      return { updated, creada };
    });

    await this.auditLog.log({
      companyId,
      usuarioId: actorId,
      usuario: actorNombre,
      accion: 'Requerimiento corregido y reenviado a aprobación',
      detalle: formatRequerimientoCodigo(updated.numero),
    });
    await this.notificarAprobadores(
      companyId,
      creada.rolesRequeridos,
      creada.tipoRegla,
      0,
      updated.titulo,
      updated.montoEstimado,
      creada.aprobacionId,
      updated.moneda,
    );
    return updated;
  }

  async addComment(
    companyId: string,
    id: string,
    autor: string,
    texto: string,
  ) {
    await this.findOne(companyId, id);
    return this.prisma.comentarioRequerimiento.create({
      data: { requerimientoId: id, autor, texto },
    });
  }

  private async ownedByCompany(companyId: string, id: string) {
    const req = await this.prisma.requerimiento.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!req) throw new NotFoundException('Requerimiento no encontrado.');
  }

  // Creates the document row up front (estado PENDIENTE) so the signed
  // upload URL can be scoped to its own id — matches the Homologación
  // pattern, which is the other per-parent-many-documents case in this app.
  async crearUrlSubidaDocumento(
    companyId: string,
    id: string,
    filename: string,
    tamanoBytes?: number,
  ) {
    await this.ownedByCompany(companyId, id);
    if (tamanoBytes)
      await this.planes.verificarAlmacenamiento(companyId, tamanoBytes);
    const doc = await this.prisma.documentoRequerimiento.create({
      data: { requerimientoId: id, nombre: filename },
    });

    const path = `${companyId}/${id}/${doc.id}/${this.storage.safeFilename(filename)}`;
    const uploadUrl = await this.storage.createUploadUrl(BUCKET, path);
    return { docId: doc.id, ...uploadUrl };
  }

  async confirmarDocumento(
    companyId: string,
    id: string,
    docId: string,
    path: string,
    actorNombre: string,
    tamanoBytes?: number,
  ) {
    const doc = await this.prisma.documentoRequerimiento.findFirst({
      where: { id: docId, requerimientoId: id, requerimiento: { companyId } },
      include: { requerimiento: { select: { numero: true } } },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    if (!path.startsWith(`${companyId}/${id}/${docId}/`)) {
      throw new BadRequestException('Ruta de archivo inválida.');
    }
    const actualizado = await this.prisma.documentoRequerimiento.update({
      where: { id: docId },
      data: {
        estado: EstadoDocumento.SUBIDO,
        storagePath: path,
        tamanoBytes: tamanoBytes ?? null,
      },
    });
    await this.auditLog.log({
      companyId,
      usuario: actorNombre,
      accion: 'Documento adjuntado a requerimiento',
      detalle: `${formatRequerimientoCodigo(doc.requerimiento.numero)} — ${doc.nombre}`,
    });
    return actualizado;
  }

  async crearUrlDescargaDocumento(
    companyId: string,
    id: string,
    docId: string,
  ) {
    const doc = await this.prisma.documentoRequerimiento.findFirst({
      where: { id: docId, requerimientoId: id, requerimiento: { companyId } },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    if (!doc.storagePath)
      throw new NotFoundException(
        'Este documento todavía no tiene un archivo adjunto.',
      );

    const { url } = await this.storage.createDownloadUrl(
      BUCKET,
      doc.storagePath,
    );
    return { url, nombre: doc.nombre };
  }

  // Adds providers beyond the shortlist chosen at creation — used any time
  // after a requerimiento is out, so invitations here are sent immediately.
  async invitarProveedores(
    companyId: string,
    id: string,
    proveedorIds: string[],
  ) {
    const req = await this.findOne(companyId, id);
    // Inviting flips the requerimiento to EN_LICITACION — allowing it before
    // approval would let anyone skip the approval matrix, and after the bid
    // closes there's nothing left to join.
    if (req.estado !== EstadoRequerimiento.EN_LICITACION) {
      throw new BadRequestException(
        'Solo puedes invitar proveedores a un requerimiento en licitación. Si está pendiente de aprobación, las invitaciones salen cuando se apruebe.',
      );
    }
    const existentes = await this.prisma.invitacion.findMany({
      where: { requerimientoId: id, proveedorId: { in: proveedorIds } },
      select: { proveedorId: true },
    });
    const yaInvitados = new Set(existentes.map((i) => i.proveedorId));

    const { elegibles: elegiblesTodos, excluidos } =
      await this.filtrarElegibles(companyId, proveedorIds);
    const elegibles = elegiblesTodos.filter((p) => !yaInvitados.has(p.id));
    if (elegibles.length === 0 && excluidos.length === 0) {
      throw new BadRequestException(
        'Los proveedores seleccionados ya fueron invitados a este proceso.',
      );
    }
    if (elegibles.length === 0) {
      throw new BadRequestException(
        'Ninguno de los proveedores seleccionados cumple los requisitos de homologación de tu empresa.',
      );
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
            '/proveedor/procesos',
          ),
        ),
    );

    const actualizado = await this.findOne(companyId, id);
    return {
      ...actualizado,
      excluidosPorHomologacion: excluidos,
    };
  }
}
