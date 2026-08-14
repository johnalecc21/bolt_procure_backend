import { Injectable, NotFoundException } from '@nestjs/common';
import { EstadoDisputa, Severidad } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateDisputaDto } from './dto/create-disputa.dto';

@Injectable()
export class DisputasService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  list(companyId: string) {
    return this.prisma.disputa.findMany({
      where: { companyId },
      include: { proveedor: true, mediador: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(companyId: string, id: string) {
    const disputa = await this.prisma.disputa.findFirst({
      where: { id, companyId },
      include: { proveedor: true, mediador: true, mensajes: { orderBy: { createdAt: 'asc' } } },
    });
    if (!disputa) throw new NotFoundException('Disputa no encontrada.');
    return disputa;
  }

  async create(companyId: string, dto: CreateDisputaDto, autor: string, autorId: string) {
    return this.prisma.disputa.create({
      data: {
        companyId,
        poReferencia: dto.poReferencia,
        proveedorId: dto.proveedorId,
        severidad: dto.severidad as Severidad,
        mensajes: { create: [{ autor, texto: dto.descripcion, autorId }] },
      },
    });
  }

  async addMensaje(companyId: string, disputaId: string, autor: string, autorId: string, texto: string) {
    await this.findOne(companyId, disputaId);
    return this.prisma.mensajeDisputa.create({ data: { disputaId, autor, autorId, texto } });
  }

  async asignarMediador(id: string, mediadorId: string) {
    return this.prisma.disputa.update({
      where: { id },
      data: { mediadorId, estado: EstadoDisputa.EN_MEDIACION },
    });
  }

  async resolver(
    id: string,
    decision: string,
    impacto: 'positivo' | 'negativo',
    actorNombre: string,
  ) {
    const disputa = await this.prisma.disputa.update({
      where: { id },
      data: { estado: EstadoDisputa.RESUELTA, resueltoAt: new Date() },
      include: { proveedor: true },
    });
    if (disputa.proveedorId) {
      await this.prisma.proveedorProfile.update({
        where: { id: disputa.proveedorId },
        data: { disputasCount: { increment: impacto === 'negativo' ? 1 : 0 } },
      });
    }
    await this.auditLog.log({
      companyId: disputa.companyId,
      usuario: actorNombre,
      accion: 'Disputa resuelta',
      detalle: `${id} — ${disputa.proveedor?.nombre ?? 'sin proveedor asociado'}`,
      motivo: `${decision} (impacto en score: ${impacto})`,
    });
    return { ok: true };
  }

  /** Interno-facing view: every disputa across every company, for the mediation queue. */
  listAll() {
    return this.prisma.disputa.findMany({
      include: { proveedor: true, mediador: true, company: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
