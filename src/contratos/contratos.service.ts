import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TipoContrato } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { SupabaseService } from '../supabase/supabase.service';
import { EmitirPoDto } from './dto/emitir-po.dto';

const BUCKET = 'contratos-documentos';

@Injectable()
export class ContratosService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private supabase: SupabaseService,
  ) {}

  list(companyId: string, params?: { categoria?: string; query?: string }) {
    return this.prisma.contrato.findMany({
      where: {
        companyId,
        ...(params?.categoria && params.categoria !== 'Todas' ? { categoria: params.categoria } : {}),
        ...(params?.query
          ? {
              OR: [
                { id: { contains: params.query, mode: 'insensitive' } },
                { proveedorNombre: { contains: params.query, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { vigenciaFin: 'asc' },
      include: {
        hitos: { orderBy: { orden: 'asc' } },
        hijas: { select: { id: true, monto: true, estado: true } },
      },
    });
  }

  async findOne(companyId: string, id: string) {
    const contrato = await this.prisma.contrato.findFirst({
      where: { id, companyId },
      include: {
        hitos: { orderBy: { orden: 'asc' } },
        hijas: { select: { id: true, monto: true, estado: true, vigenciaInicio: true, vigenciaFin: true } },
        padre: { select: { id: true, monto: true, vigenciaFin: true } },
      },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado.');
    return contrato;
  }

  // Only under a Contrato Marco — the whole point of the master agreement is
  // that individual purchase orders don't each need their own legal review.
  async emitirPo(companyId: string, contratoPadreId: string, dto: EmitirPoDto, actorNombre: string) {
    const padre = await this.prisma.contrato.findFirst({ where: { id: contratoPadreId, companyId } });
    if (!padre) throw new NotFoundException('Contrato no encontrado.');
    if (padre.tipo !== TipoContrato.CONTRATO) {
      throw new BadRequestException('Solo se pueden emitir POs bajo un Contrato Marco.');
    }
    const po = await this.prisma.contrato.create({
      data: {
        companyId,
        requerimientoId: padre.requerimientoId,
        tipo: TipoContrato.PO,
        proveedorNombre: padre.proveedorNombre,
        categoria: padre.categoria,
        monto: dto.monto,
        vigenciaInicio: new Date(dto.vigenciaInicio),
        vigenciaFin: new Date(dto.vigenciaFin),
        contratoPadreId: padre.id,
      },
    });
    await this.auditLog.log({
      usuario: actorNombre,
      accion: 'PO emitida bajo Contrato Marco',
      detalle: `${po.id} bajo ${padre.id} — $${dto.monto.toLocaleString()}`,
    });
    return po;
  }

  private async proveedorIdForUser(userId: string) {
    const profile = await this.prisma.proveedorProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('No tienes un perfil de proveedor asociado.');
    return profile.id;
  }

  async listMine(userId: string) {
    const proveedorId = await this.proveedorIdForUser(userId);
    return this.prisma.contrato.findMany({
      where: { requerimiento: { adjudicacion: { proveedorId } } },
      orderBy: { vigenciaFin: 'asc' },
      include: { hitos: { orderBy: { orden: 'asc' } }, company: true },
    });
  }

  async findOneMine(userId: string, id: string) {
    const proveedorId = await this.proveedorIdForUser(userId);
    const contrato = await this.prisma.contrato.findFirst({
      where: { id, requerimiento: { adjudicacion: { proveedorId } } },
      include: { hitos: { orderBy: { orden: 'asc' } }, company: true },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado.');
    return contrato;
  }

  // Only the company that owns the contrato can attach their own PO/contract
  // file — it replaces the Procurex-generated template as the download.
  async crearUrlSubida(companyId: string, id: string, filename: string) {
    const contrato = await this.prisma.contrato.findFirst({ where: { id, companyId } });
    if (!contrato) throw new NotFoundException('Contrato no encontrado.');

    const safeName = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const path = `${companyId}/${id}/${safeName}`;
    const { data, error } = await this.supabase.admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(path, { upsert: true });
    if (error || !data) {
      throw new BadRequestException(error?.message ?? 'No se pudo preparar la subida del archivo.');
    }
    return { path, token: data.token };
  }

  async adjuntarArchivo(companyId: string, id: string, path: string, nombre: string, actorNombre: string) {
    const contrato = await this.prisma.contrato.findFirst({ where: { id, companyId } });
    if (!contrato) throw new NotFoundException('Contrato no encontrado.');
    if (!path.startsWith(`${companyId}/${id}/`)) {
      throw new BadRequestException('Ruta de archivo inválida.');
    }
    const actualizado = await this.prisma.contrato.update({
      where: { id },
      data: { archivoStoragePath: path, archivoNombre: nombre },
    });
    await this.auditLog.log({
      usuario: actorNombre,
      accion: 'Documento propio adjuntado a contrato',
      detalle: `${id} — ${nombre}`,
    });
    return actualizado;
  }

  /** Cliente can fetch a link for any contrato in their company; proveedor only for their own. */
  async crearUrlDescarga(portal: string, companyIdOrUserId: string, id: string) {
    const contrato =
      portal === 'PROVEEDOR'
        ? await this.prisma.contrato.findFirst({
            where: { id, requerimiento: { adjudicacion: { proveedorId: await this.proveedorIdForUser(companyIdOrUserId) } } },
          })
        : await this.prisma.contrato.findFirst({ where: { id, companyId: companyIdOrUserId } });
    if (!contrato) throw new NotFoundException('Contrato no encontrado.');
    if (!contrato.archivoStoragePath) throw new NotFoundException('Este contrato no tiene un documento propio adjunto.');

    const { data, error } = await this.supabase.admin.storage
      .from(BUCKET)
      .createSignedUrl(contrato.archivoStoragePath, 300);
    if (error || !data) {
      throw new BadRequestException(error?.message ?? 'No se pudo generar el enlace de descarga.');
    }
    return { url: data.signedUrl, nombre: contrato.archivoNombre };
  }
}
