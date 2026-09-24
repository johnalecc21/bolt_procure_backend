import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Adjudicacion,
  EstadoRequerimiento,
  EstadoSubasta,
  Prisma,
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
import { calcularLineas, type LineaCalculada } from './lineas.util';

@Injectable()
export class AdjudicacionService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private notificaciones: NotificacionesService,
  ) {}

  /**
   * Every award of the requerimiento (one per proveedor; several when it was
   * split by items), or null when nothing has been awarded yet.
   */
  async findByRequerimiento(companyId: string, requerimientoId: string) {
    await this.ownedByCompany(companyId, requerimientoId);
    const [requerimiento, adjudicaciones, items] = await Promise.all([
      this.prisma.requerimiento.findUniqueOrThrow({
        where: { id: requerimientoId },
        select: { moneda: true },
      }),
      this.prisma.adjudicacion.findMany({
        where: { requerimientoId },
        include: {
          proveedor: { select: { id: true, nombre: true } },
          lineas: {
            include: { item: true },
            orderBy: { item: { orden: 'asc' } },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.itemRequerimiento.findMany({
        // Lines no proveedor was awarded (declared void).
        where: { requerimientoId, adjudicado: { is: null } },
        orderBy: { orden: 'asc' },
      }),
    ]);
    if (adjudicaciones.length === 0) return null;
    const { moneda } = requerimiento;
    // Computed here so the screen and firmar() can never disagree on it.
    return {
      moneda,
      umbralRevisionLegal: UMBRAL_REVISION_LEGAL[moneda],
      total: adjudicaciones.reduce((s, a) => s + a.precioFinal, 0),
      itemsDesiertos: items,
      adjudicaciones: adjudicaciones.map((a) => ({
        ...a,
        requiereRevisionLegal: requiereRevisionLegal(a.precioFinal, moneda),
      })),
    };
  }

  /**
   * Price and terms come from each proveedor's own sent offer — scaled by its
   * final bid when a negotiation round took place — never from the browser.
   * Adjudicating ends the tender and any round still running; it's a single
   * decision, so a requerimiento can only be awarded once.
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
    const existentes = await this.prisma.adjudicacion.count({
      where: { requerimientoId: dto.requerimientoId },
    });
    if (existentes > 0) {
      throw new ConflictException(
        'Este proceso ya tiene una adjudicación en curso.',
      );
    }

    const [items, ofertas, session] = await Promise.all([
      this.prisma.itemRequerimiento.findMany({
        where: { requerimientoId: dto.requerimientoId },
        orderBy: { orden: 'asc' },
      }),
      this.prisma.oferta.findMany({
        where: { requerimientoId: dto.requerimientoId, enviada: true },
        include: { items: true },
      }),
      this.prisma.auctionSession.findUnique({
        where: { requerimientoId: dto.requerimientoId },
        include: { pujas: true },
      }),
    ]);
    const ofertaDe = new Map(ofertas.map((o) => [o.proveedorId, o]));
    const pujaDe = new Map(
      (session?.pujas ?? []).map((p) => [p.proveedorId, p.monto]),
    );

    // proveedorId → itemIds (empty list = lump-sum award of the whole thing)
    const porProveedor = new Map<string, string[]>();
    if (items.length === 0) {
      if (!dto.proveedorId || dto.asignaciones?.length) {
        throw new BadRequestException(
          'Este requerimiento no tiene ítems: adjudícalo completo a un proveedor.',
        );
      }
      porProveedor.set(dto.proveedorId, []);
    } else if (dto.asignaciones?.length) {
      const idsItems = new Set(items.map((i) => i.id));
      for (const a of dto.asignaciones) {
        if (!idsItems.has(a.itemId))
          throw new BadRequestException('Ítem inválido en la asignación.');
        const lista = porProveedor.get(a.proveedorId) ?? [];
        if ([...porProveedor.values()].some((l) => l.includes(a.itemId)))
          throw new BadRequestException(
            'Cada ítem solo puede adjudicarse a un proveedor.',
          );
        lista.push(a.itemId);
        porProveedor.set(a.proveedorId, lista);
      }
    } else if (dto.proveedorId) {
      const oferta = ofertaDe.get(dto.proveedorId);
      porProveedor.set(
        dto.proveedorId,
        (oferta?.items ?? []).map((i) => i.itemId),
      );
    } else {
      throw new BadRequestException('Indica a quién se adjudica.');
    }

    const planes: {
      proveedorId: string;
      precioFinal: number;
      lineas: LineaCalculada[];
      oferta: (typeof ofertas)[number];
    }[] = [];
    for (const [proveedorId, itemIds] of porProveedor) {
      const oferta = ofertaDe.get(proveedorId);
      if (!oferta) {
        throw new BadRequestException(
          'Ese proveedor no presentó oferta para este requerimiento.',
        );
      }
      if (items.length === 0) {
        planes.push({
          proveedorId,
          precioFinal: pujaDe.get(proveedorId) ?? oferta.precioTotal,
          lineas: [],
          oferta,
        });
        continue;
      }
      if (itemIds.length === 0) {
        throw new BadRequestException(
          'Ese proveedor no cotizó ningún ítem de este requerimiento.',
        );
      }
      const calculo = calcularLineas(
        items,
        oferta.items,
        itemIds,
        oferta.precioTotal,
        pujaDe.get(proveedorId),
      );
      if (!calculo) {
        throw new BadRequestException(
          'Solo puedes adjudicar a un proveedor los ítems que cotizó.',
        );
      }
      planes.push({ proveedorId, ...calculo, oferta });
    }

    const ahora = new Date();
    const base = `PO-${ahora.getFullYear()}-${requerimiento.numero.toString().padStart(4, '0')}`;
    try {
      return await this.prisma.$transaction(async (tx) => {
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
        const creadas: Adjudicacion[] = [];
        for (const [i, plan] of planes.entries()) {
          creadas.push(
            await tx.adjudicacion.create({
              data: {
                requerimientoId: dto.requerimientoId,
                proveedorId: plan.proveedorId,
                precioFinal: plan.precioFinal,
                plazoDias: plan.oferta.plazoEntregaDias,
                condicionesPagoDias: plan.oferta.condicionesPagoDias,
                garantiaMeses: plan.oferta.garantiaMeses,
                // The requerimiento's number makes the PO unique; a split
                // award numbers each proveedor's PO under it.
                poId: planes.length === 1 ? base : `${base}-${i + 1}`,
                lineas: { create: plan.lineas },
              },
            }),
          );
        }
        return creadas;
      });
    } catch (err) {
      // Two buyers awarding at the same moment: the unique constraints catch it.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Este proceso ya tiene una adjudicación en curso.',
        );
      }
      throw err;
    }
  }

  /** Confirms the award decision as a whole — every proveedor it names. */
  async confirmar(
    companyId: string,
    requerimientoId: string,
    actorNombre: string,
  ) {
    await this.ownedByCompany(companyId, requerimientoId);
    const adjudicaciones = await this.listOrThrow(requerimientoId);
    // The provider needs to hear this the moment a human decides, not only
    // once the (separate, later) signature step completes — that's the real
    // "award letter" moment in procurement, even though it's conditional on
    // the contract still getting signed.
    const requerimiento = await this.prisma.requerimiento.findUniqueOrThrow({
      where: { id: requerimientoId },
      select: { titulo: true, companyId: true, numero: true, moneda: true },
    });
    const [{ count }] = await this.prisma.$transaction([
      this.prisma.adjudicacion.updateMany({
        where: { requerimientoId, confirmada: false },
        data: { confirmada: true },
      }),
      this.prisma.requerimiento.updateMany({
        where: {
          id: requerimientoId,
          estado: { not: EstadoRequerimiento.EN_CUMPLIMIENTO },
        },
        data: { estado: EstadoRequerimiento.ADJUDICADO },
      }),
    ]);
    // Already confirmed (double click, second user): don't notify twice.
    if (count === 0) return { ok: true };
    const proveedores = await this.prisma.proveedorProfile.findMany({
      where: { id: { in: adjudicaciones.map((a) => a.proveedorId) } },
      include: { user: true },
    });
    const nombre = new Map(proveedores.map((p) => [p.id, p.nombre]));
    await this.auditLog.log({
      companyId: requerimiento.companyId,
      usuario: actorNombre,
      accion: 'Adjudicación confirmada',
      detalle: `${formatRequerimientoCodigo(requerimiento.numero)} → ${adjudicaciones
        .map(
          (a) =>
            `${nombre.get(a.proveedorId) ?? a.proveedorId} (${formatMonto(a.precioFinal, requerimiento.moneda)})`,
        )
        .join(', ')}`,
    });
    const parcial = adjudicaciones.length > 1;
    await Promise.all(
      proveedores
        .filter((p) => p.user)
        .map((p) =>
          this.notificaciones.create(
            p.user!.id,
            'CONTRATO',
            '¡Fuiste seleccionado como ganador!',
            `Tu oferta para "${requerimiento.titulo}" fue seleccionada${parcial ? ' en parte de sus ítems' : ''}, sujeta a la firma del contrato. Revisa la carta de adjudicación en tu historial.`,
            '/proveedor/historial',
          ),
        ),
    );
    return { ok: true };
  }

  async revisionLegal(
    companyId: string,
    requerimientoId: string,
    actorNombre: string,
    adjudicacionId?: string,
  ) {
    await this.ownedByCompany(companyId, requerimientoId);
    const adjudicacion = await this.elegir(requerimientoId, adjudicacionId);
    const requerimiento = await this.prisma.requerimiento.findUniqueOrThrow({
      where: { id: requerimientoId },
      select: { companyId: true, numero: true },
    });
    await this.prisma.adjudicacion.update({
      where: { id: adjudicacion.id },
      data: { revisionLegal: true },
    });
    await this.auditLog.log({
      companyId: requerimiento.companyId,
      usuario: actorNombre,
      accion: 'Revisión legal completada',
      detalle: `Contrato ${adjudicacion.poId} (${formatRequerimientoCodigo(requerimiento.numero)}) desbloqueado para firma`,
    });
    return { ok: true };
  }

  /**
   * Signs one award's contract. The requerimiento moves to EN_CUMPLIMIENTO —
   * and the proveedores left out hear about it — once every award is signed.
   */
  async firmar(
    companyId: string,
    requerimientoId: string,
    actorNombre: string,
    notificarPerdedoresOverride?: boolean,
    adjudicacionId?: string,
  ) {
    await this.ownedByCompany(companyId, requerimientoId);
    const adjudicacion = await this.elegir(requerimientoId, adjudicacionId);
    if (!adjudicacion.confirmada) {
      throw new BadRequestException(
        'Confirma la adjudicación antes de enviar a firma.',
      );
    }
    if (adjudicacion.firmado) {
      throw new ConflictException('Este contrato ya fue firmado.');
    }
    const requerimiento = await this.prisma.requerimiento.findUniqueOrThrow({
      where: { id: requerimientoId },
      include: { company: { select: { umbralContratoMarco: true } } },
    });
    if (
      requiereRevisionLegal(adjudicacion.precioFinal, requerimiento.moneda) &&
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

    const { completo } = await this.prisma.$transaction(async (tx) => {
      // Conditional: two simultaneous "firmar" calls can't both create a contract.
      const { count } = await tx.adjudicacion.updateMany({
        where: { id: adjudicacion.id, firmado: false },
        data: { firmado: true, notificarPerdedores },
      });
      if (count === 0)
        throw new ConflictException('Este contrato ya fue firmado.');
      const contrato = await tx.contrato.create({
        data: {
          companyId: requerimiento.companyId,
          requerimientoId,
          tipo,
          proveedorId: proveedor.id,
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
      await tx.adjudicacion.update({
        where: { id: adjudicacion.id },
        data: { contratoId: contrato.id },
      });
      // Default 30/40/30 payment split — the client can adjust each hito's
      // porcentaje afterward from Seguimiento, before marking it completado.
      // A Contrato Marco gets none: it's a ceiling, paid through the POs
      // issued against it (each is born with its own delivery milestone).
      if (tipo === TipoContrato.PO) await tx.hitoSeguimiento.createMany({
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
      const pendientes = await tx.adjudicacion.count({
        where: { requerimientoId, firmado: false },
      });
      if (pendientes === 0) {
        await tx.requerimiento.update({
          where: { id: requerimientoId },
          data: { estado: EstadoRequerimiento.EN_CUMPLIMIENTO },
        });
      }
      return { completo: pendientes === 0 };
    });

    await this.auditLog.log({
      companyId: requerimiento.companyId,
      usuario: actorNombre,
      accion: 'Contrato firmado electrónicamente',
      detalle: `${formatRequerimientoCodigo(requerimiento.numero)} → ${proveedor.nombre} (${adjudicacion.poId})`,
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

    if (completo && notificarPerdedores) {
      const ganadores = await this.prisma.adjudicacion.findMany({
        where: { requerimientoId },
        select: { proveedorId: true },
      });
      const perdedores = await this.prisma.oferta.findMany({
        where: {
          requerimientoId,
          enviada: true,
          proveedorId: { notIn: ganadores.map((g) => g.proveedorId) },
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

    return { ok: true, poId: adjudicacion.poId, completo };
  }

  private async ownedByCompany(companyId: string, requerimientoId: string) {
    const req = await this.prisma.requerimiento.findFirst({
      where: { id: requerimientoId, companyId },
      select: { id: true, estado: true, fechaLimite: true, numero: true },
    });
    if (!req) throw new NotFoundException('Requerimiento no encontrado.');
    return req;
  }

  private async listOrThrow(requerimientoId: string) {
    const adjudicaciones = await this.prisma.adjudicacion.findMany({
      where: { requerimientoId },
    });
    if (adjudicaciones.length === 0)
      throw new NotFoundException('Este requerimiento no tiene adjudicación.');
    return adjudicaciones;
  }

  /** The award an action targets: the given one, or the only one there is. */
  private async elegir(requerimientoId: string, adjudicacionId?: string) {
    const adjudicaciones = await this.listOrThrow(requerimientoId);
    if (adjudicacionId) {
      const a = adjudicaciones.find((x) => x.id === adjudicacionId);
      if (!a) throw new NotFoundException('Adjudicación no encontrada.');
      return a;
    }
    if (adjudicaciones.length > 1) {
      throw new BadRequestException(
        'Este proceso tiene varias adjudicaciones: indica cuál.',
      );
    }
    return adjudicaciones[0];
  }
}
