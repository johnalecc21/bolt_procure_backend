import { Injectable, NotFoundException } from '@nestjs/common';
import { EstadoRequerimiento, Role, TipoAprobacion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateRequerimientoDto } from './dto/create-requerimiento.dto';

@Injectable()
export class RequerimientosService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

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
      },
    });
    if (!req) throw new NotFoundException('Requerimiento no encontrado.');
    return req;
  }

  async create(companyId: string, solicitanteId: string, dto: CreateRequerimientoDto) {
    return this.prisma.$transaction(async (tx) => {
      const requerimiento = await tx.requerimiento.create({
        data: {
          companyId,
          solicitanteId,
          titulo: dto.titulo,
          categoria: dto.categoria,
          montoEstimado: dto.montoEstimado,
          fechaLimite: new Date(dto.fechaLimite),
          criteriosPeso: dto.criteriosPeso,
          estado: EstadoRequerimiento.PENDIENTE_APROBACION,
        },
      });
      // Every new requerimiento needs a green light before it can go out to
      // tender — mirrors the approval-matrix trigger point from the spec.
      await tx.aprobacion.create({
        data: {
          requerimientoId: requerimiento.id,
          tipo: TipoAprobacion.SALIDA_LICITACION,
          monto: dto.montoEstimado,
          urgente: false,
        },
      });
      return requerimiento;
    });
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

  async invitarProveedores(companyId: string, id: string, proveedorIds: string[]) {
    const req = await this.findOne(companyId, id);
    await this.prisma.$transaction([
      ...proveedorIds.map((proveedorId) =>
        this.prisma.invitacion.create({
          data: { companyId, proveedorId, requerimientoId: id, categoria: req.categoria, fechaLimite: req.fechaLimite },
        }),
      ),
      this.prisma.requerimiento.update({
        where: { id },
        data: {
          proveedoresInvitados: { increment: proveedorIds.length },
          estado: EstadoRequerimiento.EN_LICITACION,
        },
      }),
    ]);
    return this.findOne(companyId, id);
  }
}
