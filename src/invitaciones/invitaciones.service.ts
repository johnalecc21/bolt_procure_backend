import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EstadoInvitacion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProveedoresService } from '../proveedores/proveedores.service';
import { StorageService } from '../storage/storage.service';
import { formatRequerimientoCodigo } from '../common/utils/codigo.util';

const BUCKET_REQUERIMIENTOS = 'requerimientos-documentos';

@Injectable()
export class InvitacionesService {
  constructor(
    private prisma: PrismaService,
    private proveedores: ProveedoresService,
    private storage: StorageService,
  ) {}

  /** Newest first: a fresh invitation is what the supplier came to see. */
  async listMine(userId: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const invitaciones = await this.prisma.invitacion.findMany({
      where: { proveedorId, enviada: true },
      include: {
        company: { select: { nombre: true } },
        requerimiento: {
          select: {
            numero: true,
            titulo: true,
            moneda: true,
            _count: { select: { items: true } },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    return invitaciones.map((i) => ({
      ...i,
      codigo: i.requerimiento
        ? formatRequerimientoCodigo(i.requerimiento.numero)
        : null,
    }));
  }

  private async invitacionDe(userId: string, requerimientoId: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const invitacion = await this.prisma.invitacion.findFirst({
      where: { requerimientoId, proveedorId, enviada: true },
      select: { id: true, estado: true, fechaLimite: true },
    });
    if (!invitacion)
      throw new NotFoundException('No tienes una invitación a este proceso.');
    return invitacion;
  }

  /**
   * Everything an invited supplier needs to decide and to quote: scope,
   * quantities, specifications, evaluation criteria and attachments. Never
   * the buyer's budget, internal cost center or approvals.
   */
  async requerimiento(userId: string, requerimientoId: string) {
    const invitacion = await this.invitacionDe(userId, requerimientoId);
    const r = await this.prisma.requerimiento.findUniqueOrThrow({
      where: { id: requerimientoId },
      select: {
        id: true,
        numero: true,
        titulo: true,
        descripcion: true,
        categoria: true,
        prioridad: true,
        moneda: true,
        fechaLimite: true,
        especificaciones: true,
        criteriosPeso: true,
        createdAt: true,
        company: { select: { nombre: true } },
        items: {
          orderBy: { orden: 'asc' },
          select: {
            id: true,
            orden: true,
            descripcion: true,
            cantidad: true,
            unidad: true,
            especificacion: true,
          },
        },
        documentos: {
          where: { storagePath: { not: null } },
          orderBy: { createdAt: 'asc' },
          select: { id: true, nombre: true },
        },
      },
    });
    return {
      id: r.id,
      codigo: formatRequerimientoCodigo(r.numero),
      titulo: r.titulo,
      descripcion: r.descripcion,
      categoria: r.categoria,
      prioridad: r.prioridad,
      moneda: r.moneda,
      cliente: r.company.nombre,
      publicado: r.createdAt,
      fechaLimite: invitacion.fechaLimite,
      especificaciones: Array.isArray(r.especificaciones)
        ? r.especificaciones
        : [],
      criterios: r.criteriosPeso ?? null,
      items: r.items,
      documentos: r.documentos,
      invitacion: { id: invitacion.id, estado: invitacion.estado },
    };
  }

  async documento(userId: string, requerimientoId: string, docId: string) {
    await this.invitacionDe(userId, requerimientoId);
    const doc = await this.prisma.documentoRequerimiento.findFirst({
      where: { id: docId, requerimientoId, storagePath: { not: null } },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    const { url } = await this.storage.createDownloadUrl(
      BUCKET_REQUERIMIENTOS,
      doc.storagePath!,
    );
    return { url, nombre: doc.nombre };
  }

  async responder(userId: string, id: string, estado: 'VISTA' | 'DECLINADA') {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const invitacion = await this.prisma.invitacion.findFirst({
      where: { id, proveedorId },
    });
    if (!invitacion) throw new NotFoundException('Invitación no encontrada.');
    // Once the offer is sent or the process closed, the answer is final.
    if (
      invitacion.estado === EstadoInvitacion.RESPONDIDA ||
      invitacion.estado === EstadoInvitacion.VENCIDA
    )
      throw new BadRequestException('Esta invitación ya no se puede cambiar.');
    return this.prisma.invitacion.update({
      where: { id },
      data: { estado: estado },
    });
  }

  async crear(
    companyId: string,
    proveedorId: string,
    requerimientoId: string,
    categoria: string,
    fechaLimite: Date,
  ) {
    return this.prisma.invitacion.create({
      data: { companyId, proveedorId, requerimientoId, categoria, fechaLimite },
    });
  }
}
