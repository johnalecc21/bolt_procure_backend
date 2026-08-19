import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Portal, TipoContrato } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ProveedoresService } from '../proveedores/proveedores.service';
import { StorageService } from '../storage/storage.service';
import { formatContratoCodigo } from '../common/utils/codigo.util';
import { EmitirPoDto } from './dto/emitir-po.dto';

const BUCKET = 'contratos-documentos';

@Injectable()
export class ContratosService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private proveedores: ProveedoresService,
    private storage: StorageService,
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
      // The screen does live client-side search/filter over this list, so it
      // isn't page-paginated — this is a growth guard-rail, not a page size.
      take: 200,
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
        company: { select: { nombre: true } },
        requerimiento: {
          select: {
            titulo: true,
            descripcion: true,
            adjudicacion: { select: { garantiaMeses: true, plazoDias: true } },
          },
        },
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
      companyId,
      usuario: actorNombre,
      accion: 'PO emitida bajo Contrato Marco',
      detalle: `${formatContratoCodigo(po.tipo, po.numero)} bajo ${formatContratoCodigo(padre.tipo, padre.numero)} — $${dto.monto.toLocaleString()}`,
    });
    return po;
  }


  async listMine(userId: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    return this.prisma.contrato.findMany({
      where: { requerimiento: { adjudicacion: { proveedorId } } },
      orderBy: { vigenciaFin: 'asc' },
      include: { hitos: { orderBy: { orden: 'asc' } }, company: true },
      take: 200,
    });
  }

  async findOneMine(userId: string, id: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const contrato = await this.prisma.contrato.findFirst({
      where: { id, requerimiento: { adjudicacion: { proveedorId } } },
      include: {
        hitos: { orderBy: { orden: 'asc' } },
        company: true,
        requerimiento: {
          select: {
            titulo: true,
            descripcion: true,
            adjudicacion: { select: { garantiaMeses: true, plazoDias: true } },
          },
        },
      },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado.');
    return contrato;
  }

  // Only the company that owns the contrato can attach their own PO/contract
  // file — it replaces the Procurex-generated template as the download.
  async crearUrlSubida(companyId: string, id: string, filename: string) {
    const contrato = await this.prisma.contrato.findFirst({ where: { id, companyId } });
    if (!contrato) throw new NotFoundException('Contrato no encontrado.');

    const path = `${companyId}/${id}/${this.storage.safeFilename(filename)}`;
    return this.storage.createUploadUrl(BUCKET, path);
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
      companyId,
      usuario: actorNombre,
      accion: 'Documento propio adjuntado a contrato',
      detalle: `${formatContratoCodigo(actualizado.tipo, actualizado.numero)} — ${nombre}`,
    });
    return actualizado;
  }

  /** Cliente can fetch a link for any contrato in their company; proveedor only for their own. */
  async crearUrlDescarga(portal: Portal, companyIdOrUserId: string, id: string) {
    const contrato =
      portal === Portal.PROVEEDOR
        ? await this.prisma.contrato.findFirst({
            where: { id, requerimiento: { adjudicacion: { proveedorId: await this.proveedores.findIdForUser(companyIdOrUserId) } } },
          })
        : await this.prisma.contrato.findFirst({ where: { id, companyId: companyIdOrUserId } });
    if (!contrato) throw new NotFoundException('Contrato no encontrado.');
    if (!contrato.archivoStoragePath) throw new NotFoundException('Este contrato no tiene un documento propio adjunto.');

    const { url } = await this.storage.createDownloadUrl(BUCKET, contrato.archivoStoragePath);
    return { url, nombre: contrato.archivoNombre };
  }
}
