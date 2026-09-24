import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EstadoRequerimiento,
  EstadoSubasta,
  TipoContrato,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { formatRequerimientoCodigo } from '../common/utils/codigo.util';
import { CreateAdjudicacionDto } from './dto/create-adjudicacion.dto';
import {
  formatMonto,
  requiereRevisionLegal,
  UMBRAL_REVISION_LEGAL,
} from '../common/utils/moneda.util';

@Injectable()
export class AdjudicacionService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private notificaciones: NotificacionesService,
  ) {}

  async findByRequerimiento(companyId: string, requerimientoId: string) {
    await this.ownedByCompany(companyId, requerimientoId);
    const adjudicacion = await this.prisma.adjudicacion.findUnique({
      where: { requerimientoId },
      include: { requerimiento: { select: { moneda: true } } },
    });
    if (!adjudicacion) return null;
    const { requerimiento, ...rest } = adjudicacion;
    // Computed here so the screen and firmar() can never disagree on it.
    return {
      ...rest,
      umbralRevisionLegal: UMBRAL_REVISION_LEGAL[requerimiento.moneda],
      requiereRevisionLegal: requiereRevisionLegal(
        rest.precioFinal,
        requerimiento.moneda,
      ),
    };
  }

  /**
   * Price and terms come from the proveedor's own sent offer — or, if a
   * negotiation round took place, from its final bid there — never from the
   * browser. Adjudicating ends the tender and any round still running.
   */
  async create(companyId: string, dto: CreateAdjudicacionDto) {
    const requerimiento = await this.ownedByCompany(
      companyId,
      dto.requerimientoId,
    );
    const permitidos: EstadoRequerimiento[] = [
      EstadoRequerimiento.EN_LICITACION,
      EstadoRequerimiento.EN_NEGOCIACION,
    ];
    if (!permitidos.includes(requerimiento.estado)) {
      throw new BadRequestException(
        'Solo se puede adjudicar un proceso en licitación o en negociación.',
      );
    }
    const oferta = await this.prisma.oferta.findFirst({
      where: {
        requerimientoId: dto.requerimientoId,
        proveedorId: dto.proveedorId,
        enviada: true,
      },
    });
    if (!oferta) {
      throw new BadRequestException(
        'Ese proveedor no presentó oferta para este requerimiento.',
      );
    }
    const existente = await this.prisma.adjudicacion.findUnique({
      where: { requerimientoId: dto.requerimientoId },
    });
    if (existente) {
      throw new ConflictException(
        'Este proceso ya tiene una adjudicación en curso.',
      );
    }

    const session = await this.prisma.auctionSession.findUnique({
      where: { requerimientoId: dto.requerimientoId },
      include: { pujas: { where: { proveedorId: dto.proveedorId } } },
    });
    const precioFinal = session?.pujas[0]?.monto ?? oferta.precioTotal;
    const ahora = new Date();

    return this.prisma.$transaction(async (tx) => {
      if (session?.status === EstadoSubasta.ACTIVA) {
        await tx.auctionSession.update({
          where: { id: session.id },
          data: { status: EstadoSubasta.CERRADA },
        });
      }
      if (requerimiento.fechaLimite > ahora) {
        await tx.requerimiento.update({
          where: { id: dto.requerimientoId },
          data: { fechaLimite: ahora },
        });
        await tx.invitacion.updateMany({
          where: { requerimientoId: dto.requerimientoId },
          data: { fechaLimite: ahora },
        });
      }
      return tx.adjudicacion.create({
        data: {
          requerimientoId: dto.requerimientoId,
          proveedorId: dto.proveedorId,
          precioFinal,
          plazoDias: oferta.plazoEntregaDias,
          condicionesPagoDias: oferta.condicionesPagoDias,
          garantiaMeses: oferta.garantiaMeses,
          // One adjudicación per requerimiento, so its number makes the PO unique.
          poId: `PO-${ahora.getFullYear()}-${requerimiento.numero.toString().padStart(4, '0')}`,
        },
      });
    });
  }

  async confirmar(
    companyId: string,
    requerimientoId: string,
    actorNombre: string,
  ) {
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
    const [{ count }] = await this.prisma.$transaction([
      this.prisma.adjudicacion.updateMany({
        where: { requerimientoId, confirmada: false },
        data: { confirmada: true },
      }),
      this.prisma.requerimiento.update({
        where: { id: requerimientoId },
        data: { estado: EstadoRequerimiento.ADJUDICADO },
      }),
    ]);
    // Already confirmed (double click, second user): don't notify twice.
    if (count === 0) return { ok: true };
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

  async revisionLegal(
    companyId: string,
    requerimientoId: string,
    actorNombre: string,
  ) {
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

  async firmar(
    companyId: string,
    requerimientoId: string,
    actorNombre: string,
    notificarPerdedoresOverride?: boolean,
  ) {
    await this.ownedByCompany(companyId, requerimientoId);
    const adjudicacion = await this.getOrThrow(requerimientoId);
    if (!adjudicacion.confirmada) {
      throw new BadRequestException(
        'Confirma la adjudicación antes de enviar a firma.',
      );
    }
    if (adjudicacion.firmado) {
      throw new ConflictException('Este contrato ya fue firmado.');
    }
    const { moneda } = await this.prisma.requerimiento.findUniqueOrThrow({
      where: { id: requerimientoId },
      select: { moneda: true },
    });
    if (
      requiereRevisionLegal(adjudicacion.precioFinal, moneda) &&
      !adjudicacion.revisionLegal
    ) {
      throw new BadRequestException(
        'Completa la revisión legal antes de enviar a firma.',
      );
    }
    // The checkbox on the firma screen is the actual decision point — it
    // overrides whatever was set (or defaulted) when the adjudicación was
    // first created, and we persist it so the record reflects what happened.
    const notificarPerdedores =
      notificarPerdedoresOverride ?? adjudicacion.notificarPerdedores;

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
      // Conditional: two simultaneous "firmar" calls can't both create a contract.
      const { count } = await tx.adjudicacion.updateMany({
        where: { requerimientoId, firmado: false },
        data: { firmado: true, notificarPerdedores },
      });
      if (count === 0)
        throw new ConflictException('Este contrato ya fue firmado.');
      await tx.requerimiento.update({
        where: { id: requerimientoId },
        data: { estado: EstadoRequerimiento.EN_CUMPLIMIENTO },
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
          {
            contratoId: contrato.id,
            label: 'Inicio del contrato',
            comprometido: hoy,
            orden: 0,
            porcentaje: 30,
          },
          {
            contratoId: contrato.id,
            label: 'Entrega',
            comprometido: entrega,
            orden: 1,
            porcentaje: 40,
          },
          {
            contratoId: contrato.id,
            label: 'Cierre y conformidad',
            comprometido: cierre,
            orden: 2,
            porcentaje: 30,
          },
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
        where: {
          requerimientoId,
          proveedorId: { not: adjudicacion.proveedorId },
        },
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
    const req = await this.prisma.requerimiento.findFirst({
      where: { id: requerimientoId, companyId },
      select: { id: true, estado: true, fechaLimite: true, numero: true },
    });
    if (!req) throw new NotFoundException('Requerimiento no encontrado.');
    return req;
  }

  private async getOrThrow(requerimientoId: string) {
    const adjudicacion = await this.prisma.adjudicacion.findUnique({
      where: { requerimientoId },
    });
    if (!adjudicacion)
      throw new NotFoundException('Este requerimiento no tiene adjudicación.');
    return adjudicacion;
  }
}
