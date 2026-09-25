import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EstadoHomologacion,
  EstadoInvitacion,
  EstadoRequerimiento,
  Moneda,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { formatRequerimientoCodigo } from '../common/utils/codigo.util';
import { ProveedoresService } from '../proveedores/proveedores.service';
import { PlantillasService } from '../plantillas/plantillas.service';
import { UpsertOfertaDto } from './dto/upsert-oferta.dto';
import { calcularCompetencia } from '../analitica/competencia.util';
import { resultadoProveedor } from '../adjudicacion/resultado.util';
import { subtotalLinea } from '../adjudicacion/lineas.util';

@Injectable()
export class OfertasService {
  constructor(
    private prisma: PrismaService,
    private proveedores: ProveedoresService,
    private plantillas: PlantillasService,
  ) {}

  /**
   * The winning supplier's copy of its award letter, in the buyer's own
   * format when the buyer has one. Only once the award is confirmed.
   */
  async cartaAdjudicacion(userId: string, requerimientoId: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const adj = await this.prisma.adjudicacion.findFirst({
      where: { requerimientoId, proveedorId, confirmada: true },
      select: { id: true, requerimiento: { select: { companyId: true } } },
    });
    if (!adj)
      throw new NotFoundException(
        'No tienes una adjudicación en este proceso.',
      );
    return this.plantillas.cartaAdjudicacion(
      adj.requerimiento.companyId,
      requerimientoId,
      adj.id,
    );
  }

  async listByRequerimiento(companyId: string, requerimientoId: string) {
    const req = await this.prisma.requerimiento.findFirst({
      where: { id: requerimientoId, companyId },
      select: { id: true },
    });
    if (!req) throw new NotFoundException('Requerimiento no encontrado.');
    return this.prisma.oferta.findMany({
      where: { requerimientoId },
      include: {
        proveedor: true,
        items: { select: { itemId: true, precioUnitario: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // The provider's own in-progress board: every proceso they've accepted to
  // bid on (declined/not-yet-accepted invitations don't belong here — those
  // live in Bandeja de Invitaciones), paired with whatever offer state they
  // have for it, draft or already sent. Also picks up any oferta row that
  // exists without a matching accepted invitación — shouldn't normally
  // happen, but a provider with a real offer on file should never be told
  // there's nothing to see.
  async listMine(userId: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const [invitacionesAceptadas, ofertas] = await Promise.all([
      this.prisma.invitacion.findMany({
        where: {
          proveedorId,
          enviada: true,
          estado: { in: [EstadoInvitacion.VISTA, EstadoInvitacion.RESPONDIDA] },
        },
        include: {
          company: true,
          requerimiento: {
            select: {
              numero: true,
              titulo: true,
              categoria: true,
              moneda: true,
              estado: true,
            },
          },
        },
      }),
      this.prisma.oferta.findMany({
        where: { proveedorId },
        include: { requerimiento: { include: { company: true } } },
      }),
    ]);

    const porRequerimiento = new Map<
      string,
      {
        requerimientoId: string;
        codigo: string | null;
        titulo: string;
        cliente: string;
        categoria: string;
        moneda: Moneda;
        fechaLimite: Date;
        /** Stage of the purchase process (live auction, awarded…). */
        estadoProceso: EstadoRequerimiento | null;
        /** When it landed on the supplier's board (for newest-first order). */
        desde: Date;
        oferta: { enviada: boolean; precioTotal: number } | null;
      }
    >();
    for (const inv of invitacionesAceptadas) {
      if (!inv.requerimientoId) continue;
      porRequerimiento.set(inv.requerimientoId, {
        requerimientoId: inv.requerimientoId,
        codigo: inv.requerimiento
          ? formatRequerimientoCodigo(inv.requerimiento.numero)
          : null,
        titulo: inv.requerimiento?.titulo ?? '',
        cliente: inv.company.nombre,
        categoria: inv.requerimiento?.categoria ?? inv.categoria,
        moneda: inv.requerimiento?.moneda ?? Moneda.USD,
        fechaLimite: inv.fechaLimite,
        estadoProceso: inv.requerimiento?.estado ?? null,
        desde: inv.createdAt,
        oferta: null,
      });
    }
    for (const o of ofertas) {
      const previa = porRequerimiento.get(o.requerimientoId);
      porRequerimiento.set(o.requerimientoId, {
        requerimientoId: o.requerimientoId,
        codigo: formatRequerimientoCodigo(o.requerimiento.numero),
        titulo: o.requerimiento.titulo,
        cliente: o.requerimiento.company.nombre,
        categoria: o.requerimiento.categoria,
        moneda: o.requerimiento.moneda,
        fechaLimite: o.requerimiento.fechaLimite,
        estadoProceso: o.requerimiento.estado,
        desde: previa?.desde ?? o.createdAt,
        oferta: { enviada: o.enviada, precioTotal: o.precioTotal },
      });
    }
    // Newest process first.
    return Array.from(porRequerimiento.values()).sort(
      (a, b) => b.desde.getTime() - a.desde.getTime(),
    );
  }

  async mine(userId: string, requerimientoId: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const [oferta, invitado] = await Promise.all([
      this.prisma.oferta.findUnique({
        where: {
          requerimientoId_proveedorId: { requerimientoId, proveedorId },
        },
        include: { items: { select: { itemId: true, precioUnitario: true } } },
      }),
      this.prisma.invitacion.findFirst({
        where: { requerimientoId, proveedorId, enviada: true },
        select: { id: true },
      }),
    ]);
    // The bill of quantities to price, for invited proveedores only.
    const lineas =
      invitado || oferta
        ? await this.prisma.itemRequerimiento.findMany({
            where: { requerimientoId },
            orderBy: { orden: 'asc' },
            select: {
              id: true,
              descripcion: true,
              cantidad: true,
              unidad: true,
              especificacion: true,
            },
          })
        : [];
    if (oferta) return { ...oferta, lineas };
    // No Prisma record yet — return an explicit empty shape rather than null,
    // since NestJS sends a null/undefined response body as empty (Content-Length: 0),
    // which the frontend's `data ?? fallback` can't distinguish from a parse failure.
    return {
      precioUnitario: 0,
      precioTotal: 0,
      plazoEntregaDias: 0,
      condicionesPagoDias: 0,
      garantiaMeses: 0,
      vigenciaOfertaDias: 0,
      enviada: false,
      items: [],
      lineas,
    };
  }

  /** Offers can only be created, edited or sent while the tender is open. */
  private async assertLicitacionAbierta(requerimientoId: string) {
    const req = await this.prisma.requerimiento.findUnique({
      where: { id: requerimientoId },
      select: { estado: true, fechaLimite: true },
    });
    if (!req) throw new NotFoundException('Proceso no encontrado.');
    if (
      req.estado !== EstadoRequerimiento.EN_LICITACION ||
      req.fechaLimite <= new Date()
    ) {
      throw new ConflictException(
        'La licitación ya cerró; no se reciben más ofertas.',
      );
    }
  }

  async upsert(userId: string, dto: UpsertOfertaDto) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    await this.assertLicitacionAbierta(dto.requerimientoId);
    // Only a proveedor actually invited to this proceso can hold an oferta on it.
    const invitado = await this.prisma.invitacion.findFirst({
      where: {
        requerimientoId: dto.requerimientoId,
        proveedorId,
        enviada: true,
      },
    });
    if (!invitado) {
      throw new ForbiddenException(
        'No tienes una invitación activa para este proceso.',
      );
    }
    // Working on an offer is the answer to the invitation: there is no
    // separate "accept" step. A supplier who had declined can change its mind
    // while the tender is open.
    if (
      invitado.estado === EstadoInvitacion.NUEVA ||
      invitado.estado === EstadoInvitacion.DECLINADA
    ) {
      const ahora = new Date();
      await this.prisma.invitacion.update({
        where: { id: invitado.id },
        data: {
          estado: EstadoInvitacion.VISTA,
          respondidaAt: ahora,
          vistaAt: invitado.vistaAt ?? ahora,
        },
      });
    }
    const existing = await this.prisma.oferta.findUnique({
      where: {
        requerimientoId_proveedorId: {
          requerimientoId: dto.requerimientoId,
          proveedorId,
        },
      },
    });
    if (existing?.enviada) {
      throw new BadRequestException(
        'Esta oferta ya fue enviada y no es editable.',
      );
    }
    const { items: precios, ...campos } = dto;
    const lineas = await this.prisma.itemRequerimiento.findMany({
      where: { requerimientoId: dto.requerimientoId },
      select: { id: true, cantidad: true },
    });
    let data = campos;
    if (lineas.length > 0) {
      // Itemized: the total is the sum of the quoted lines, never the browser's.
      const cantidadDe = new Map(lineas.map((l) => [l.id, l.cantidad]));
      const vistos = new Set<string>();
      for (const p of precios ?? []) {
        if (!cantidadDe.has(p.itemId) || vistos.has(p.itemId)) {
          throw new BadRequestException('Hay líneas inválidas en la oferta.');
        }
        vistos.add(p.itemId);
      }
      if (!precios?.length) {
        throw new BadRequestException('Cotiza al menos un ítem.');
      }
      data = {
        ...campos,
        precioUnitario: 0,
        precioTotal: precios.reduce(
          (s, p) =>
            s + subtotalLinea(cantidadDe.get(p.itemId)!, p.precioUnitario),
          0,
        ),
      };
    } else if (precios?.length) {
      throw new BadRequestException('Este requerimiento no tiene ítems.');
    }
    return this.prisma.$transaction(async (tx) => {
      const oferta = await tx.oferta.upsert({
        where: {
          requerimientoId_proveedorId: {
            requerimientoId: dto.requerimientoId,
            proveedorId,
          },
        },
        create: { ...data, proveedorId },
        update: { ...data },
      });
      if (lineas.length > 0) {
        await tx.itemOferta.deleteMany({ where: { ofertaId: oferta.id } });
        await tx.itemOferta.createMany({
          data: precios!.map((p) => ({
            ofertaId: oferta.id,
            itemId: p.itemId,
            precioUnitario: p.precioUnitario,
          })),
        });
      }
      return oferta;
    });
  }

  async enviar(userId: string, requerimientoId: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const homologacion = await this.prisma.homologacion.findUnique({
      where: { proveedorId },
    });
    if (homologacion?.estado !== EstadoHomologacion.APROBADO) {
      throw new ForbiddenException(
        'Tu homologación debe estar aprobada para poder enviar ofertas.',
      );
    }
    await this.assertLicitacionAbierta(requerimientoId);
    const oferta = await this.prisma.oferta.findUnique({
      where: { requerimientoId_proveedorId: { requerimientoId, proveedorId } },
    });
    if (!oferta)
      throw new NotFoundException('Aún no has completado tu oferta.');
    // Conditional update so a double click can't count the same offer twice.
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.oferta.updateMany({
        where: { id: oferta.id, enviada: false },
        data: { enviada: true, enviadaAt: new Date() },
      });
      if (count === 0)
        throw new ConflictException('Esta oferta ya fue enviada.');
      await tx.requerimiento.update({
        where: { id: requerimientoId },
        data: { ofertasRecibidas: { increment: 1 } },
      });
    });
    return { ok: true };
  }

  async miHistorial(userId: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const misOfertas = await this.prisma.oferta.findMany({
      where: { proveedorId, enviada: true },
      include: {
        requerimiento: {
          include: {
            company: true,
            adjudicaciones: true,
            ofertas: {
              where: { enviada: true },
              select: { proveedorId: true, precioTotal: true },
            },
            auctionSession: {
              select: { pujas: { select: { proveedorId: true, monto: true } } },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const procesos = misOfertas.map((o) => {
      const { resultado, mia, parcial, precioComparable } = resultadoProveedor(
        o.requerimiento.adjudicaciones,
        proveedorId,
      );
      let feedback: string | undefined;
      if (resultado === 'perdido') {
        // Specific feedback only when the buyer opted in; the winner's name
        // and other bids are never disclosed either way.
        const c =
          o.requerimiento.company.feedbackCompetitivo && precioComparable
            ? calcularCompetencia(
                o.requerimiento.ofertas.map((x) => ({
                  proveedorId: x.proveedorId,
                  precio: x.precioTotal,
                })),
                (o.requerimiento.auctionSession?.pujas ?? []).map((p) => ({
                  proveedorId: p.proveedorId,
                  precio: p.monto,
                })),
                proveedorId,
                precioComparable,
              )
            : null;
        feedback = c
          ? `Quedaste ${c.posicion}° de ${c.participantes} por precio; tu precio final estuvo ${(c.brechaPct * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })}% ${c.brechaPct >= 0 ? 'por encima' : 'por debajo'} del adjudicado. La decisión también pondera plazo, calidad y condiciones de pago.`
          : parcial
            ? 'El proceso se adjudicó por ítems a otros proveedores con mejor precio por línea.'
            : 'El proceso fue adjudicado a otro proveedor con mejor relación precio-calidad.';
      }
      const adj = mia;
      const awardTerms =
        (resultado === 'seleccionado' || resultado === 'ganado') && adj
          ? {
              poId: adj.poId,
              precioFinal: adj.precioFinal,
              plazoDias: adj.plazoDias,
              condicionesPagoDias: adj.condicionesPagoDias,
              garantiaMeses: adj.garantiaMeses,
              adjudicacionParcial: parcial,
            }
          : {};
      return {
        id: o.id,
        requerimientoId: o.requerimientoId,
        titulo: o.requerimiento.titulo,
        cliente: o.requerimiento.company.nombre,
        fecha: o.createdAt,
        monto: o.precioTotal,
        moneda: o.requerimiento.moneda,
        resultado,
        feedback,
        ...awardTerms,
      };
    });

    const proveedor = await this.prisma.proveedorProfile.findUniqueOrThrow({
      where: { id: proveedorId },
    });
    // Averages only make sense within one currency: compare in the one this
    // proveedor quotes in most, against the market in that same currency.
    const conteoMonedas = new Map<Moneda, number>();
    for (const o of misOfertas) {
      conteoMonedas.set(
        o.requerimiento.moneda,
        (conteoMonedas.get(o.requerimiento.moneda) ?? 0) + 1,
      );
    }
    const monedaPrincipal =
      [...conteoMonedas.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
      Moneda.USD;
    const ofertasEnMoneda = misOfertas.filter(
      (o) => o.requerimiento.moneda === monedaPrincipal,
    );
    const miPromedio = ofertasEnMoneda.length
      ? ofertasEnMoneda.reduce((sum, o) => sum + o.precioTotal, 0) /
        ofertasEnMoneda.length
      : 0;
    // An aggregate query, not findMany + reduce — this used to load every
    // market oferta into memory just to average one column, unbounded and
    // growing with every offer ever submitted in the category.
    const mercadoAgg = await this.prisma.oferta.aggregate({
      where: {
        enviada: true,
        requerimiento: {
          categoria: { in: proveedor.categorias },
          moneda: monedaPrincipal,
        },
      },
      _avg: { precioTotal: true },
    });
    const mercadoPromedio = mercadoAgg._avg.precioTotal ?? miPromedio;
    const tuOfertaPromedioVsMercado = mercadoPromedio
      ? Math.round(((miPromedio - mercadoPromedio) / mercadoPromedio) * 100)
      : 0;

    return { procesos, competitividad: { tuOfertaPromedioVsMercado } };
  }
}
