import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EstadoRequerimiento, TipoContrato } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { CreateAdjudicacionDto } from './dto/create-adjudicacion.dto';

const UMBRAL_LEGAL = 50000;

@Injectable()
export class AdjudicacionService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private notificaciones: NotificacionesService,
  ) {}

  async findByRequerimiento(requerimientoId: string) {
    return this.prisma.adjudicacion.findUnique({ where: { requerimientoId } });
  }

  async create(dto: CreateAdjudicacionDto) {
    const year = new Date().getFullYear();
    const poId = `PO-${year}-${Math.floor(1000 + Math.random() * 9000)}`;
    return this.prisma.adjudicacion.create({ data: { ...dto, poId } });
  }

  async confirmar(requerimientoId: string, actorNombre: string) {
    const adjudicacion = await this.getOrThrow(requerimientoId);
    await this.prisma.adjudicacion.update({
      where: { requerimientoId },
      data: { confirmada: true },
    });
    await this.auditLog.log({
      usuario: actorNombre,
      accion: 'Adjudicación confirmada',
      detalle: `${requerimientoId} → ${adjudicacion.proveedorId} ($${adjudicacion.precioFinal})`,
    });
    return { ok: true };
  }

  async revisionLegal(requerimientoId: string, actorNombre: string) {
    await this.getOrThrow(requerimientoId);
    await this.prisma.adjudicacion.update({
      where: { requerimientoId },
      data: { revisionLegal: true },
    });
    await this.auditLog.log({
      usuario: actorNombre,
      accion: 'Revisión legal completada',
      detalle: `Contrato ${requerimientoId} desbloqueado para firma`,
    });
    return { ok: true };
  }

  async firmar(requerimientoId: string, actorNombre: string) {
    const adjudicacion = await this.getOrThrow(requerimientoId);
    if (!adjudicacion.confirmada) {
      throw new BadRequestException('Confirma la adjudicación antes de enviar a firma.');
    }
    if (adjudicacion.precioFinal > UMBRAL_LEGAL && !adjudicacion.revisionLegal) {
      throw new BadRequestException('Completa la revisión legal antes de enviar a firma.');
    }

    const requerimiento = await this.prisma.requerimiento.findUniqueOrThrow({
      where: { id: requerimientoId },
    });
    const proveedor = await this.prisma.proveedorProfile.findUniqueOrThrow({
      where: { id: adjudicacion.proveedorId },
      include: { user: true },
    });

    const hoy = new Date();
    const vigenciaFin = new Date(hoy);
    vigenciaFin.setFullYear(vigenciaFin.getFullYear() + 1);

    const [, , contrato] = await this.prisma.$transaction([
      this.prisma.adjudicacion.update({ where: { requerimientoId }, data: { firmado: true } }),
      this.prisma.requerimiento.update({
        where: { id: requerimientoId },
        data: { estado: EstadoRequerimiento.ADJUDICADO },
      }),
      this.prisma.contrato.create({
        data: {
          companyId: requerimiento.companyId,
          requerimientoId,
          tipo: TipoContrato.PO,
          proveedorNombre: proveedor.nombre,
          categoria: requerimiento.categoria,
          monto: adjudicacion.precioFinal,
          vigenciaInicio: hoy,
          vigenciaFin,
        },
      }),
    ]);

    // Seed a sensible default delivery timeline off the agreed plazoDias so every
    // signed contract starts with real tracking — the client can rename, add,
    // remove, or reschedule these afterward from the Seguimiento screen.
    const entrega = new Date(hoy);
    entrega.setDate(entrega.getDate() + adjudicacion.plazoDias);
    const cierre = new Date(entrega);
    cierre.setDate(cierre.getDate() + 5);
    await this.prisma.hitoSeguimiento.createMany({
      data: [
        { contratoId: contrato.id, label: 'Inicio del contrato', comprometido: hoy, orden: 0 },
        { contratoId: contrato.id, label: 'Entrega', comprometido: entrega, orden: 1 },
        { contratoId: contrato.id, label: 'Cierre y conformidad', comprometido: cierre, orden: 2 },
      ],
    });

    await this.auditLog.log({
      usuario: actorNombre,
      accion: 'Contrato firmado electrónicamente',
      detalle: `${requerimientoId} → ${proveedor.nombre}`,
    });

    if (proveedor.user) {
      await this.notificaciones.create(
        proveedor.user.id,
        'CONTRATO',
        '¡Ganaste el proceso!',
        `${requerimiento.titulo} fue adjudicado a tu empresa. Orden de compra ${adjudicacion.poId} — revisa el detalle en Mis Contratos.`,
      );
    }

    if (adjudicacion.notificarPerdedores) {
      const perdedores = await this.prisma.oferta.findMany({
        where: { requerimientoId, proveedorId: { not: adjudicacion.proveedorId } },
        include: { proveedor: { include: { user: true } } },
      });
      for (const oferta of perdedores) {
        const userId = oferta.proveedor.user?.id;
        if (userId) {
          await this.notificaciones.create(
            userId,
            'OFERTA',
            'Proceso adjudicado a otro proveedor',
            `${requerimiento.titulo} fue adjudicado a otro participante. Revisa el feedback en tu historial.`,
          );
        }
      }
    }

    return { ok: true, poId: adjudicacion.poId };
  }

  private async getOrThrow(requerimientoId: string) {
    const adjudicacion = await this.prisma.adjudicacion.findUnique({ where: { requerimientoId } });
    if (!adjudicacion) throw new NotFoundException('Este requerimiento no tiene adjudicación.');
    return adjudicacion;
  }
}
