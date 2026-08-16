import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EstadoDocumento, EstadoHomologacion, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ProveedoresService } from '../proveedores/proveedores.service';
import { StorageService } from '../storage/storage.service';
import { HomologacionScoringService } from './homologacion-scoring.service';

const BUCKET = 'homologacion-documentos';

@Injectable()
export class HomologacionService {

  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private proveedores: ProveedoresService,
    private storage: StorageService,
    private scoring: HomologacionScoringService,
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
      include: { documentos: true, proveedor: true },
    });
    if (!homologacion) throw new NotFoundException('Aún no has iniciado tu homologación.');
    if (homologacion.estado === EstadoHomologacion.EN_REVISION) {
      throw new ConflictException('Tu homologación ya fue enviada y está en revisión.');
    }
    if (homologacion.estado === EstadoHomologacion.ZONA_GRIS) {
      throw new ConflictException('Tu homologación está en revisión manual por nuestro equipo de compliance.');
    }
    const estadoPrevio = homologacion.estado;

    const { score, alertas, nitDetectado } = await this.scoring.evaluar(
      homologacion.documentos,
      homologacion.proveedor.nombre,
    );
    const estado = alertas.length > 0 ? EstadoHomologacion.ZONA_GRIS : EstadoHomologacion.EN_REVISION;

    const actualizado = await this.prisma.homologacion.update({
      where: { proveedorId },
      data: { estado, score, alertas, nitDetectado, fechaSolicitud: new Date() },
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
      detalle: `Score ${score}${alertas.length ? `, ${alertas.length} alerta(s)` : ''}`,
    });

    return actualizado;
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
        ? [this.prisma.proveedorProfile.update({ where: { id: proveedorId }, data: { score } })]
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
