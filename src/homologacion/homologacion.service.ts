import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EstadoDocumento, EstadoHomologacion, NivelRiesgo, Portal, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ProveedoresService } from '../proveedores/proveedores.service';
import { StorageService } from '../storage/storage.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { HomologacionScoringService, NIVEL_RIESGO_INFO } from './homologacion-scoring.service';
import { CuestionarioDto } from './dto/cuestionario.dto';
import { camposFaltantes, HomologacionCuestionario } from './homologacion-cuestionario.types';

const BUCKET = 'homologacion-documentos';
const REEVALUACION_DEFAULT_DIAS = 365;

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
      include: { documentos: true },
    });
    if (!homologacion) throw new NotFoundException('Aún no has iniciado tu homologación.');
    return homologacion;
  }

  async guardarCuestionario(userId: string, dto: CuestionarioDto) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const homologacion = await this.prisma.homologacion.findUnique({ where: { proveedorId } });
    if (!homologacion) throw new NotFoundException('Aún no has iniciado tu homologación.');
    if (homologacion.estado === EstadoHomologacion.EN_REVISION || homologacion.estado === EstadoHomologacion.ZONA_GRIS) {
      throw new ConflictException('Tu homologación está en revisión. No puedes modificar el cuestionario hasta que Procurex resuelva.');
    }

    const actual = (homologacion.cuestionario as HomologacionCuestionario | null) ?? {};
    // Draft save merges — a proveedor filling section 3 shouldn't wipe what they
    // already saved in section 1, since each Paso only submits its own fields.
    const merged: HomologacionCuestionario = { ...actual, ...dto };
    return this.prisma.homologacion.update({
      where: { proveedorId },
      data: { cuestionario: merged as object },
      include: { documentos: true },
    });
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
    if (estadoHomologacion === EstadoHomologacion.APROBADO && doc.estado !== EstadoDocumento.VENCIDO) {
      throw new ConflictException('Este documento ya fue validado. Solo puedes actualizar documentos vencidos.');
    }

    return this.prisma.documentoHomologacion.update({
      where: { id: documentoId },
      data: { estado: EstadoDocumento.SUBIDO, storagePath: path },
    });
  }

  /** Proveedores can only fetch a link for their own docs; Compliance/Ops can fetch any (for review). */
  async crearUrlDescarga(userId: string, portal: Portal, role: Role, documentoId: string) {
    const doc = await this.prisma.documentoHomologacion.findUnique({
      where: { id: documentoId },
      include: { homologacion: true },
    });
    if (!doc || !doc.storagePath) throw new NotFoundException('Documento no encontrado.');

    if (portal === Portal.PROVEEDOR) {
      const proveedorId = await this.proveedores.findIdForUser(userId);
      if (doc.homologacion.proveedorId !== proveedorId) {
        throw new ForbiddenException('Este documento no te pertenece.');
      }
    } else if (!(portal === Portal.INTERNO && role === Role.COMPLIANCE_OPS)) {
      throw new ForbiddenException('No tienes acceso a este documento.');
    }

    return this.storage.createDownloadUrl(BUCKET, doc.storagePath);
  }

  async enviar(userId: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const homologacion = await this.prisma.homologacion.findUnique({
      where: { proveedorId },
      include: { documentos: true, proveedor: true },
    });
    if (!homologacion) throw new NotFoundException('Aún no has iniciado tu homologación.');
    if (homologacion.estado === EstadoHomologacion.EN_REVISION) {
      throw new ConflictException('Tu homologación ya fue enviada y está en revisión.');
    }
    if (homologacion.estado === EstadoHomologacion.ZONA_GRIS) {
      throw new ConflictException('Tu homologación está en revisión manual por nuestro equipo de compliance.');
    }

    const cuestionario = (homologacion.cuestionario as HomologacionCuestionario | null) ?? {};
    const faltantes = camposFaltantes(cuestionario);
    if (faltantes.length > 0) {
      throw new BadRequestException(
        `Completa el cuestionario antes de enviarlo a validación. Falta: ${faltantes.join(', ')}.`,
      );
    }
    const sinSubir = homologacion.documentos.filter((d) => d.estado === EstadoDocumento.PENDIENTE);
    if (sinSubir.length > 0) {
      throw new BadRequestException(
        `Sube todos los documentos requeridos antes de enviar. Falta: ${sinSubir.map((d) => d.nombre).join(', ')}.`,
      );
    }

    const estadoPrevio = homologacion.estado;

    const { score, scoreDesglose, nivelRiesgo, alertas, nitDetectado } = await this.scoring.evaluar(
      homologacion.documentos,
      homologacion.proveedor.nombre,
      cuestionario,
    );
    const estado = alertas.length > 0 ? EstadoHomologacion.ZONA_GRIS : EstadoHomologacion.EN_REVISION;

    const actualizado = await this.prisma.homologacion.update({
      where: { proveedorId },
      data: {
        estado,
        score,
        scoreDesglose: scoreDesglose as object,
        nivelRiesgo,
        alertas,
        nitDetectado,
        observaciones: null,
        fechaSolicitud: new Date(),
      },
      include: { documentos: true },
    });

    await this.auditLog.log({
      usuarioId: userId,
      usuario: homologacion.proveedor.nombre,
      accion:
        estadoPrevio === EstadoHomologacion.APROBADO
          ? 'Homologación reenviada a revisión tras renovar documentos'
          : estadoPrevio === EstadoHomologacion.RECHAZADO
            ? 'Homologación reenviada a revisión tras rechazo'
            : 'Homologación enviada a revisión',
      detalle: `Score ${score} (riesgo ${NIVEL_RIESGO_INFO[nivelRiesgo].label})${alertas.length ? `, ${alertas.length} alerta(s)` : ''}`,
    });

    return actualizado;
  }

  cola() {
    return this.prisma.homologacion.findMany({
      where: { estado: { in: [EstadoHomologacion.EN_REVISION, EstadoHomologacion.ZONA_GRIS] } },
      include: { documentos: true, proveedor: true },
      orderBy: { fechaSolicitud: 'asc' },
      // Cross-tenant queue with no natural per-caller scope to bound it by —
      // growth guard-rail, not page size.
      take: 200,
    });
  }

  async resolver(
    proveedorId: string,
    estado: 'APROBADO' | 'RECHAZADO',
    actorNombre: string,
    scoreOverride?: number,
    motivo?: string,
  ) {
    const homologacion = await this.prisma.homologacion.findUnique({
      where: { proveedorId },
      include: { proveedor: true },
    });
    if (!homologacion) throw new NotFoundException('Homologación no encontrada.');

    const score = scoreOverride ?? homologacion.score;
    const nivelRiesgo = homologacion.nivelRiesgo ?? NivelRiesgo.MEDIO;
    const reevaluacionDias = NIVEL_RIESGO_INFO[nivelRiesgo]?.reevaluacionDias ?? REEVALUACION_DEFAULT_DIAS;

    // Both writes must land together — a homologación left APROBADO with a
    // stale ProveedorProfile.score would silently corrupt the public
    // directory ranking (ordered by that same score) and offer matching.
    await this.prisma.$transaction([
      this.prisma.homologacion.update({
        where: { proveedorId },
        data: {
          estado: estado as EstadoHomologacion,
          score,
          proximaRevalidacion: new Date(Date.now() + 1000 * 60 * 60 * 24 * reevaluacionDias),
        },
      }),
      ...(estado === 'APROBADO'
        ? [this.prisma.proveedorProfile.update({ where: { id: proveedorId }, data: { score } })]
        : []),
    ]);
    await this.auditLog.log({
      usuario: actorNombre,
      accion: estado === 'APROBADO' ? 'Homologación aprobada' : 'Homologación rechazada',
      detalle: homologacion.proveedor.nombre,
      motivo,
    });
    if (homologacion.proveedor.userId) {
      await this.notificaciones.create(
        homologacion.proveedor.userId,
        'PROVEEDOR',
        estado === 'APROBADO' ? 'Homologación aprobada' : 'Homologación rechazada',
        estado === 'APROBADO'
          ? 'Tu empresa ya está homologada y disponible para ser invitada a licitaciones.'
          : `Tu homologación fue rechazada.${motivo ? ` Motivo: ${motivo}` : ''}`,
        '/proveedor/dashboard',
      );
    }
    return { ok: true };
  }

  /** Compliance pide información/documentos faltantes — devuelve la homologación a BORRADOR para que el proveedor la corrija (paso 4 del flujograma). */
  async solicitarInfo(proveedorId: string, actorNombre: string, mensaje: string) {
    const homologacion = await this.prisma.homologacion.findUnique({
      where: { proveedorId },
      include: { proveedor: true },
    });
    if (!homologacion) throw new NotFoundException('Homologación no encontrada.');
    if (homologacion.estado !== EstadoHomologacion.EN_REVISION && homologacion.estado !== EstadoHomologacion.ZONA_GRIS) {
      throw new ConflictException('Solo puedes pedir información sobre una homologación en revisión.');
    }

    const actualizado = await this.prisma.homologacion.update({
      where: { proveedorId },
      data: { estado: EstadoHomologacion.BORRADOR, observaciones: mensaje },
    });
    await this.auditLog.log({
      usuario: actorNombre,
      accion: 'Información adicional solicitada al proveedor',
      detalle: homologacion.proveedor.nombre,
      motivo: mensaje,
    });
    if (homologacion.proveedor.userId) {
      await this.notificaciones.create(
        homologacion.proveedor.userId,
        'PROVEEDOR',
        'Compliance solicitó información adicional',
        mensaje,
        '/proveedor/homologacion',
      );
    }
    return actualizado;
  }
}
