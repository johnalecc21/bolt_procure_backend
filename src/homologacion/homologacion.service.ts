import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CategoriaDocumento, EstadoDocumento, EstadoHomologacion, ResultadoLista, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ProveedoresService } from '../proveedores/proveedores.service';
import { StorageService } from '../storage/storage.service';
import { HomologacionScoringService } from './homologacion-scoring.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';

const BUCKET = 'homologacion-documentos';

@Injectable()
export class HomologacionService {

  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private proveedores: ProveedoresService,
    private storage: StorageService,
    private scoring: HomologacionScoringService,
    private notificaciones: NotificacionesService,
  ) {}

  async mine(userId: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const homologacion = await this.prisma.homologacion.findUnique({
      where: { proveedorId },
      include: { documentos: { orderBy: { obligatorio: 'desc' } }, verificaciones: { orderBy: { lista: 'asc' } } },
    });
    if (!homologacion) throw new NotFoundException('Aún no has iniciado tu homologación.');
    return homologacion;
  }

  async crearUrlSubida(userId: string, documentoId: string, filename: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const doc = await this.prisma.documentoHomologacion.findFirst({
      where: { id: documentoId, homologacion: { proveedorId } },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado.');

    const path = `${proveedorId}/${documentoId}/${this.storage.safeFilename(filename)}`;
    return this.storage.createUploadUrl(BUCKET, path);
  }

  async subirDocumento(userId: string, documentoId: string, path: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const doc = await this.prisma.documentoHomologacion.findFirst({
      where: { id: documentoId, homologacion: { proveedorId } },
      include: { homologacion: true },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    if (!path.startsWith(`${proveedorId}/${documentoId}/`)) {
      throw new BadRequestException('Ruta de archivo inválida.');
    }

    const estadoHomologacion = doc.homologacion.estado;
    if (estadoHomologacion === EstadoHomologacion.EN_REVISION || estadoHomologacion === EstadoHomologacion.ZONA_GRIS) {
      throw new ConflictException(
        'Tu homologación está en revisión. No puedes modificar documentos hasta que Procurex resuelva.',
      );
    }
    // An approved proveedor can still renew expired documents and add the
    // optional ones it never uploaded — those go to Compliance one by one
    // (validarDocumento) without reopening the whole homologación.
    const opcionalNuevo = !doc.obligatorio && doc.estado === EstadoDocumento.PENDIENTE;
    if (estadoHomologacion === EstadoHomologacion.APROBADO && doc.estado !== EstadoDocumento.VENCIDO && !opcionalNuevo) {
      throw new ConflictException('Este documento ya fue validado. Solo puedes actualizar documentos vencidos.');
    }

    return this.prisma.documentoHomologacion.update({
      where: { id: documentoId },
      data: { estado: EstadoDocumento.SUBIDO, storagePath: path },
    });
  }

  /** Proveedores can only fetch a link for their own docs; Compliance/Ops can fetch any (for review). */
  async crearUrlDescarga(userId: string, portal: string, role: Role, documentoId: string) {
    const doc = await this.prisma.documentoHomologacion.findUnique({
      where: { id: documentoId },
      include: { homologacion: true },
    });
    if (!doc || !doc.storagePath) throw new NotFoundException('Documento no encontrado.');

    if (portal === 'PROVEEDOR') {
      const proveedorId = await this.proveedores.findIdForUser(userId);
      if (doc.homologacion.proveedorId !== proveedorId) {
        throw new ForbiddenException('Este documento no te pertenece.');
      }
    } else if (!(portal === 'INTERNO' && role === Role.COMPLIANCE_OPS)) {
      throw new ForbiddenException('No tienes acceso a este documento.');
    }

    return this.storage.createDownloadUrl(BUCKET, doc.storagePath);
  }

  async enviar(userId: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const homologacion = await this.prisma.homologacion.findUnique({
      where: { proveedorId },
      include: { documentos: true, proveedor: { include: { user: { select: { nombre: true } } } } },
    });
    if (!homologacion) throw new NotFoundException('Aún no has iniciado tu homologación.');
    if (homologacion.estado === EstadoHomologacion.EN_REVISION) {
      throw new ConflictException('Tu homologación ya fue enviada y está en revisión.');
    }
    if (homologacion.estado === EstadoHomologacion.ZONA_GRIS) {
      throw new ConflictException('Tu homologación está en revisión manual por nuestro equipo de compliance.');
    }
    const faltantes = homologacion.documentos.filter((d) => d.obligatorio && !d.storagePath);
    if (faltantes.length > 0) {
      throw new BadRequestException(
        `Faltan documentos obligatorios: ${faltantes.map((d) => d.nombre).join(', ')}.`,
      );
    }
    const estadoPrevio = homologacion.estado;

    const { score, alertas, nitDetectado, verificaciones } = await this.scoring.evaluar(homologacion.documentos, {
      proveedorNombre: homologacion.proveedor.nombre,
      representanteNombre: homologacion.proveedor.user?.nombre,
      ubicacion: homologacion.proveedor.ubicacion,
    });
    const estado = alertas.length > 0 ? EstadoHomologacion.ZONA_GRIS : EstadoHomologacion.EN_REVISION;

    // Each envío is a fresh screening — the previous round's list results
    // (including manual checks) no longer describe what's being submitted.
    const [, actualizado] = await this.prisma.$transaction([
      this.prisma.verificacionLista.deleteMany({ where: { homologacionId: homologacion.id } }),
      this.prisma.homologacion.update({
        where: { proveedorId },
        data: {
          estado,
          score,
          alertas,
          nitDetectado,
          fechaSolicitud: new Date(),
          verificaciones: { create: verificaciones },
        },
        include: { documentos: true, verificaciones: { orderBy: { lista: 'asc' } } },
      }),
    ]);

    await this.auditLog.log({
      usuarioId: userId,
      usuario: homologacion.proveedor.nombre,
      accion:
        estadoPrevio === EstadoHomologacion.APROBADO
          ? 'Homologación reenviada a revisión tras renovar documentos'
          : estadoPrevio === EstadoHomologacion.RECHAZADO
            ? 'Homologación reenviada a revisión tras rechazo'
            : 'Homologación enviada a revisión',
      detalle: `Score ${score}${alertas.length ? `, ${alertas.length} alerta(s)` : ''}`,
    });

    return actualizado;
  }

  /** Pending reviews: whole homologaciones, plus approved ones with individual documents awaiting validation. */
  cola() {
    return this.prisma.homologacion.findMany({
      where: {
        OR: [
          { estado: { in: [EstadoHomologacion.EN_REVISION, EstadoHomologacion.ZONA_GRIS] } },
          { estado: EstadoHomologacion.APROBADO, documentos: { some: { estado: EstadoDocumento.SUBIDO } } },
        ],
      },
      include: { documentos: true, proveedor: true, verificaciones: { orderBy: { lista: 'asc' } } },
    });
  }

  /** Compliance validates (or rejects) a single document uploaded after the homologación was approved. */
  async validarDocumento(documentoId: string, valido: boolean, actorNombre: string, motivo?: string) {
    const doc = await this.prisma.documentoHomologacion.findUnique({
      where: { id: documentoId },
      include: { homologacion: { include: { proveedor: true } } },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    if (doc.estado !== EstadoDocumento.SUBIDO) {
      throw new ConflictException('Solo se pueden validar documentos subidos y pendientes de revisión.');
    }
    if (doc.homologacion.estado !== EstadoHomologacion.APROBADO) {
      throw new ConflictException('Este documento se revisa junto con la homologación completa.');
    }
    const actualizado = await this.prisma.documentoHomologacion.update({
      where: { id: documentoId },
      data: valido ? { estado: EstadoDocumento.VALIDADO } : { estado: EstadoDocumento.PENDIENTE, storagePath: null },
    });
    const proveedor = doc.homologacion.proveedor;
    await this.auditLog.log({
      usuario: actorNombre,
      accion: valido ? 'Documento de homologación validado' : 'Documento de homologación rechazado',
      detalle: `${proveedor.nombre} — ${doc.nombre}`,
      motivo,
    });
    if (proveedor.userId) {
      await this.notificaciones.create(
        proveedor.userId,
        'PROVEEDOR',
        valido ? 'Documento validado' : 'Documento rechazado',
        valido
          ? `"${doc.nombre}" fue validado y ya cuenta para los clientes que lo exigen.`
          : `"${doc.nombre}" fue rechazado${motivo ? `: ${motivo}` : ''}. Súbelo de nuevo desde tu homologación.`,
        '/proveedor/homologacion',
      );
    }
    return actualizado;
  }

  /**
   * Compliance records the outcome of a list check — either a manual one
   * (Procuraduría, Contraloría, Policía) or a reviewed automated hit that
   * turned out to be a homonym (COINCIDENCIA → SIN_COINCIDENCIA with a note).
   */
  async registrarVerificacion(
    proveedorId: string,
    lista: string,
    resultado: ResultadoLista,
    detalle: string | undefined,
    actorNombre: string,
  ) {
    const homologacion = await this.prisma.homologacion.findUnique({
      where: { proveedorId },
      include: { proveedor: true },
    });
    if (!homologacion) throw new NotFoundException('Homologación no encontrada.');
    if (resultado !== ResultadoLista.SIN_COINCIDENCIA && resultado !== ResultadoLista.COINCIDENCIA) {
      throw new BadRequestException('Registra el resultado de la consulta: sin coincidencia o coincidencia.');
    }

    const verificacion = await this.prisma.verificacionLista.upsert({
      where: { homologacionId_lista: { homologacionId: homologacion.id, lista } },
      create: { homologacionId: homologacion.id, lista, resultado, detalle, verificadoPor: actorNombre },
      update: { resultado, detalle, verificadoPor: actorNombre },
    });
    await this.auditLog.log({
      usuario: actorNombre,
      accion: 'Verificación en lista restrictiva registrada',
      detalle: `${homologacion.proveedor.nombre} — ${lista}: ${resultado}`,
      motivo: detalle,
    });
    return verificacion;
  }

  async getRequisitos(companyId: string) {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { categoriasHomologacionRequeridas: true },
    });
    return { categorias: company.categoriasHomologacionRequeridas };
  }

  async updateRequisitos(companyId: string, categorias: CategoriaDocumento[], actorNombre: string) {
    const unicas = [...new Set(categorias)];
    await this.prisma.company.update({
      where: { id: companyId },
      data: { categoriasHomologacionRequeridas: unicas },
    });
    await this.auditLog.log({
      companyId,
      usuario: actorNombre,
      accion: 'Requisitos de homologación actualizados',
      detalle: unicas.length ? unicas.join(', ') : 'Solo homologación aprobada',
    });
    return { categorias: unicas };
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
      include: { proveedor: true, verificaciones: true },
    });
    if (!homologacion) throw new NotFoundException('Homologación no encontrada.');
    if (estado === 'APROBADO') {
      const bloqueantes = homologacion.verificaciones.filter(
        // An unreachable list is as unresolved as a pending manual check —
        // Compliance records the outcome after checking the source directly.
        (v) => v.resultado !== ResultadoLista.SIN_COINCIDENCIA,
      );
      if (bloqueantes.length > 0) {
        throw new ConflictException(
          `Antes de aprobar, resuelve las verificaciones en listas: ${bloqueantes.map((v) => v.lista).join(', ')}.`,
        );
      }
    }

    // Both writes must land together — a homologación left APROBADO with a
    // stale ProveedorProfile.score would silently corrupt the public
    // directory ranking (ordered by that same score) and offer matching.
    await this.prisma.$transaction([
      this.prisma.homologacion.update({
        where: { proveedorId },
        data: {
          estado: estado as EstadoHomologacion,
          score,
          proximaRevalidacion: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
        },
      }),
      ...(estado === 'APROBADO'
        ? [
            this.prisma.proveedorProfile.update({ where: { id: proveedorId }, data: { score } }),
            // Approval is the review of what was uploaded — without this no
            // document ever reaches VALIDADO, and per-company requirements
            // (which check VALIDADO) could never be met.
            this.prisma.documentoHomologacion.updateMany({
              where: { homologacionId: homologacion.id, estado: EstadoDocumento.SUBIDO },
              data: { estado: EstadoDocumento.VALIDADO },
            }),
          ]
        : []),
    ]);
    await this.auditLog.log({
      usuario: actorNombre,
      accion: estado === 'APROBADO' ? 'Homologación aprobada' : 'Homologación rechazada',
      detalle: homologacion.proveedor.nombre,
      motivo,
    });
    return { ok: true };
  }
}
