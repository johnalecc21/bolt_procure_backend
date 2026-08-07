import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EstadoDocumento, EstadoHomologacion, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { SupabaseService } from '../supabase/supabase.service';
import { OcrService } from './ocr.service';
import { OfacService } from './ofac.service';

const BUCKET = 'homologacion-documentos';

@Injectable()
export class HomologacionService {
  private readonly logger = new Logger(HomologacionService.name);

  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private supabase: SupabaseService,
    private ocr: OcrService,
    private ofac: OfacService,
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

  async crearUrlSubida(userId: string, documentoId: string, filename: string) {
    const proveedorId = await this.proveedorIdForUser(userId);
    const doc = await this.prisma.documentoHomologacion.findFirst({
      where: { id: documentoId, homologacion: { proveedorId } },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado.');

    const safeName = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const path = `${proveedorId}/${documentoId}/${safeName}`;
    const { data, error } = await this.supabase.admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(path, { upsert: true });
    if (error || !data) {
      throw new BadRequestException(error?.message ?? 'No se pudo preparar la subida del archivo.');
    }
    return { path, token: data.token, signedUrl: data.signedUrl };
  }

  async subirDocumento(userId: string, documentoId: string, path: string) {
    const proveedorId = await this.proveedorIdForUser(userId);
    const doc = await this.prisma.documentoHomologacion.findFirst({
      where: { id: documentoId, homologacion: { proveedorId } },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    if (!path.startsWith(`${proveedorId}/${documentoId}/`)) {
      throw new BadRequestException('Ruta de archivo inválida.');
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
      const proveedorId = await this.proveedorIdForUser(userId);
      if (doc.homologacion.proveedorId !== proveedorId) {
        throw new ForbiddenException('Este documento no te pertenece.');
      }
    } else if (!(portal === 'INTERNO' && role === Role.COMPLIANCE_OPS)) {
      throw new ForbiddenException('No tienes acceso a este documento.');
    }

    const { data, error } = await this.supabase.admin.storage
      .from(BUCKET)
      .createSignedUrl(doc.storagePath, 300);
    if (error || !data) {
      throw new BadRequestException(error?.message ?? 'No se pudo generar el enlace de descarga.');
    }
    return { url: data.signedUrl };
  }

  async enviar(userId: string) {
    const proveedorId = await this.proveedorIdForUser(userId);
    const homologacion = await this.prisma.homologacion.findUnique({
      where: { proveedorId },
      include: { documentos: true, proveedor: true },
    });
    if (!homologacion) throw new NotFoundException('Aún no has iniciado tu homologación.');

    const alertas: string[] = [];
    let score = 70;

    for (const doc of homologacion.documentos) {
      if (!doc.storagePath) continue;
      const filename = doc.storagePath.split('/').pop() ?? doc.storagePath;
      const { data, error } = await this.supabase.admin.storage.from(BUCKET).download(doc.storagePath);
      if (error || !data) {
        this.logger.warn(`No se pudo descargar ${doc.storagePath}: ${error?.message}`);
        alertas.push(`No se pudo leer el documento "${doc.nombre}".`);
        continue;
      }
      const buffer = Buffer.from(await data.arrayBuffer());
      const text = await this.ocr.extractText(buffer, filename);
      if (!text) {
        alertas.push(`No se pudo extraer texto del documento "${doc.nombre}" (OCR).`);
        continue;
      }
      if (doc.nombre.toLowerCase().includes('nit') || doc.nombre.toLowerCase().includes('rut')) {
        const digitsOnly = text.replace(/[^0-9]/g, '');
        if (!/\d{9,10}/.test(digitsOnly)) {
          alertas.push(`No se detectó un número de NIT/RUT válido en "${doc.nombre}".`);
        } else {
          score += 10;
        }
      }
    }

    const ofacResult = await this.ofac.checkName(homologacion.proveedor.nombre);
    if (ofacResult.matched) {
      alertas.push(
        `Posible coincidencia en la lista OFAC/SDN: "${ofacResult.matchedName}" (similitud ${Math.round((ofacResult.similarity ?? 0) * 100)}%).`,
      );
      score = Math.min(score, 20);
    } else {
      score += 10;
    }

    score = Math.max(0, Math.min(100, score));
    const estado = alertas.length > 0 ? EstadoHomologacion.ZONA_GRIS : EstadoHomologacion.EN_REVISION;

    return this.prisma.homologacion.update({
      where: { proveedorId },
      data: { estado, score, alertas, fechaSolicitud: new Date() },
      include: { documentos: true },
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
