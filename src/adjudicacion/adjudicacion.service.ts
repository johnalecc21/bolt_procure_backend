import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EstadoRequerimiento, TipoContrato } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { formatRequerimientoCodigo } from '../common/utils/codigo.util';
import { CreateAdjudicacionDto } from './dto/create-adjudicacion.dto';
import { formatMonto } from '../common/utils/moneda.util';

const UMBRAL_LEGAL = 50000;

@Injectable()
export class AdjudicacionService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private notificaciones: NotificacionesService,
  ) {}

  async findByRequerimiento(companyId: string, requerimientoId: string) {
    await this.ownedByCompany(companyId, requerimientoId);
    return this.prisma.adjudicacion.findUnique({ where: { requerimientoId } });
  }

  async create(companyId: string, dto: CreateAdjudicacionDto) {
    await this.ownedByCompany(companyId, dto.requerimientoId);
    const oferta = await this.prisma.oferta.findFirst({
      where: { requerimientoId: dto.requerimientoId, proveedorId: dto.proveedorId, enviada: true },
      select: { id: true },
    });
    if (!oferta) {
      throw new BadRequestException('Ese proveedor no presentó oferta para este requerimiento.');
    }
    const year = new Date().getFullYear();
    const poId = `PO-${year}-${Math.floor(1000 + Math.random() * 9000)}`;
    return this.prisma.adjudicacion.create({ data: { ...dto, poId } });
  }

  async confirmar(companyId: string, requerimientoId: string, actorNombre: string) {
    await this.ownedByCompany(companyId, requerimientoId);
    const adjudicacion = await this.getOrThrow(requerimientoId);
    // The provider needs to hear this the moment a human decides, not only
    // once the (separate, later) signature step completes — that's the real
    // "award letter" moment in procurement, even though it's conditional on
    // the contract still getting signed.
    const requerimiento = await this.prisma.requerimiento.findUnique({
      where: { id: requerimientoId },
      select: { titulo: true, companyId: true, numero: true, moneda: true },
    });
    await this.prisma.adjudicacion.update({
      where: { requerimientoId },
      data: { confirmada: true },
    });
    const proveedor = await this.prisma.proveedorProfile.findUnique({
      where: { id: adjudicacion.proveedorId },
      include: { user: true },
    });
    await this.auditLog.log({
      companyId: requerimiento?.companyId,
      usuario: actorNombre,
      accion: 'Adjudicación confirmada',
      detalle: `${requerimiento ? formatRequerimientoCodigo(requerimiento.numero) : requerimientoId} → ${proveedor?.nombre ?? adjudicacion.proveedorId} (${formatMonto(adjudicacion.precioFinal, requerimiento?.moneda)})`,
    });
    if (requerimiento && proveedor?.user) {
      await this.notificaciones.create(
        proveedor.user.id,
        'CONTRATO',
        '¡Fuiste seleccionado como ganador!',
        `Tu oferta para "${requerimiento.titulo}" fue seleccionada, sujeta a la firma del contrato. Revisa la carta de adjudicación en tu historial.`,
        '/proveedor/historial',
      );
    }
    return { ok: true };
  }

  async revisionLegal(companyId: string, requerimientoId: string, actorNombre: string) {
    await this.ownedByCompany(companyId, requerimientoId);
    await this.getOrThrow(requerimientoId);
    const requerimiento = await this.prisma.requerimiento.findUniqueOrThrow({
      where: { id: requerimientoId },
      select: { companyId: true, numero: true },
    });
    await this.prisma.adjudicacion.update({
      where: { requerimientoId },
      data: { revisionLegal: true },
    });
    await this.auditLog.log({
      companyId: requerimiento.companyId,
      usuario: actorNombre,
      accion: 'Revisión legal completada',
      detalle: `Contrato ${formatRequerimientoCodigo(requerimiento.numero)} desbloqueado para firma`,
    });
    return { ok: true };
  }

  async firmar(companyId: string, requerimientoId: string, actorNombre: string, notificarPerdedoresOverride?: boolean) {
    await this.ownedByCompany(companyId, requerimientoId);
    const adjudicacion = await this.getOrThrow(requerimientoId);
    if (!adjudicacion.confirmada) {
      throw new BadRequestException('Confirma la adjudicación antes de enviar a firma.');
    }
    if (adjudicacion.precioFinal > UMBRAL_LEGAL && !adjudicacion.revisionLegal) {
      throw new BadRequestException('Completa la revisión legal antes de enviar a firma.');
    }
    // The checkbox on the firma screen is the actual decision point — it
    // overrides whatever was set (or defaulted) when the adjudicación was
    // first created, and we persist it so the record reflects what happened.
    const notificarPerdedores = notificarPerdedoresOverride ?? adjudicacion.notificarPerdedores;

    const requerimiento = await this.prisma.requerimiento.findUniqueOrThrow({
      where: { id: requerimientoId },
      include: { company: { select: { umbralContratoMarco: true } } },
    });
    const proveedor = await this.prisma.proveedorProfile.findUniqueOrThrow({
      where: { id: adjudicacion.proveedorId },
      include: { user: true },
    });

    const hoy = new Date();
    const vigenciaFin = new Date(hoy);
    vigenciaFin.setFullYear(vigenciaFin.getFullYear() + 1);
    // Below the threshold: a simple transactional PO. At or above it: a
    // Contrato Marco — POs issued against it later (emitirPo) inherit its
    // vigencia and terms instead of each needing their own legal review.
    const tipo =
      adjudicacion.precioFinal >= requerimiento.company.umbralContratoMarco
        ? TipoContrato.CONTRATO
        : TipoContrato.PO;

    // Seed a sensible default delivery timeline off the agreed plazoDias so every
    // signed contract starts with real tracking — the client can rename, add,
    // remove, or reschedule these afterward from the Seguimiento screen.
    const entrega = new Date(hoy);
    entrega.setDate(entrega.getDate() + adjudicacion.plazoDias);
    const cierre = new Date(entrega);
    cierre.setDate(cierre.getDate() + 5);

    const contrato = await this.prisma.$transaction(async (tx) => {
      await tx.adjudicacion.update({ where: { requerimientoId }, data: { firmado: true, notificarPerdedores } });
      await tx.requerimiento.update({
        where: { id: requerimientoId },
        data: { estado: EstadoRequerimiento.ADJUDICADO },
      });
      const contrato = await tx.contrato.create({
        data: {
          companyId: requerimiento.companyId,
          requerimientoId,
          tipo,
          proveedorNombre: proveedor.nombre,
          categoria: requerimiento.categoria,
          monto: adjudicacion.precioFinal,
          moneda: requerimiento.moneda,
          centroCostoId: requerimiento.centroCostoId,
          vigenciaInicio: hoy,
          vigenciaFin,
          condicionesPagoDias: adjudicacion.condicionesPagoDias,
        },
      });
      // Default 30/40/30 payment split — the client can adjust each hito's
      // porcentaje afterward from Seguimiento, before marking it completado.
      await tx.hitoSeguimiento.createMany({
        data: [
          { contratoId: contrato.id, label: 'Inicio del contrato', comprometido: hoy, orden: 0, porcentaje: 30 },
          { contratoId: contrato.id, label: 'Entrega', comprometido: entrega, orden: 1, porcentaje: 40 },
          { contratoId: contrato.id, label: 'Cierre y conformidad', comprometido: cierre, orden: 2, porcentaje: 30 },
        ],
      });
      return contrato;
    });

    await this.auditLog.log({
      companyId: requerimiento.companyId,
      usuario: actorNombre,
      accion: 'Contrato firmado electrónicamente',
      detalle: `${formatRequerimientoCodigo(requerimiento.numero)} → ${proveedor.nombre}`,
    });

    if (proveedor.user) {
      await this.notificaciones.create(
        proveedor.user.id,
        'CONTRATO',
        '¡Ganaste el proceso!',
        `${requerimiento.titulo} fue adjudicado a tu empresa. Orden de compra ${adjudicacion.poId} — revisa el detalle en Mis Contratos.`,
        '/proveedor/contratos',
      );
    }

    if (notificarPerdedores) {
      const perdedores = await this.prisma.oferta.findMany({
        where: { requerimientoId, proveedorId: { not: adjudicacion.proveedorId } },
        include: { proveedor: { include: { user: true } } },
      });
      await Promise.all(
        perdedores
          .map((oferta) => oferta.proveedor.user?.id)
          .filter((userId): userId is string => !!userId)
          .map((userId) =>
            this.notificaciones.create(
              userId,
              'OFERTA',
              'Proceso adjudicado a otro proveedor',
              `${requerimiento.titulo} fue adjudicado a otro participante. Revisa el feedback en tu historial.`,
              '/proveedor/historial',
            ),
          ),
      );
    }

    return { ok: true, poId: adjudicacion.poId };
  }

  private async ownedByCompany(companyId: string, requerimientoId: string) {
    const req = await this.prisma.requerimiento.findFirst({ where: { id: requerimientoId, companyId }, select: { id: true } });
    if (!req) throw new NotFoundException('Requerimiento no encontrado.');
  }

  private async getOrThrow(requerimientoId: string) {
    const adjudicacion = await this.prisma.adjudicacion.findUnique({ where: { requerimientoId } });
    if (!adjudicacion) throw new NotFoundException('Este requerimiento no tiene adjudicación.');
    return adjudicacion;
  }
}
