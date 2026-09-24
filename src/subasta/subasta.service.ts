import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EstadoSubasta } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProveedoresService } from '../proveedores/proveedores.service';

/** Round lengths the cliente can pick — anything else is rejected, not clamped. */
export const DURACIONES_PERMITIDAS_MIN = [30, 60, 120, 1440] as const;

export interface IniciarOpciones {
  duracionMin: number;
  /** 'finalistas' = the 3 lowest sent offers; 'todos' = every sent offer. */
  participantes: 'finalistas' | 'todos';
}

export interface AuctionViewer {
  portal: 'CLIENTE' | 'PROVEEDOR' | 'INTERNO';
  companyId?: string;
  proveedorId?: string;
}

@Injectable()
export class SubastaService {
  constructor(
    private prisma: PrismaService,
    private proveedores: ProveedoresService,
  ) {}

  // Non-throwing, unlike ProveedoresService.findIdForUser — a socket/REST
  // caller here should just end up with no proveedorId (silently unable to
  // bid) rather than have the whole auth/handshake reject.
  async proveedorIdForUser(userId: string): Promise<string | undefined> {
    try {
      return await this.proveedores.findIdForUser(userId);
    } catch {
      return undefined;
    }
  }

  async getState(requerimientoId: string) {
    // The deadline is authoritative even if no instance was alive to close the
    // round on time (restart, scale-down): the first read after it closes it.
    await this.cerrarSiVencida(requerimientoId);
    const session = await this.prisma.auctionSession.findUnique({
      where: { requerimientoId },
      include: { pujas: true },
    });
    if (!session) {
      return {
        requerimientoId,
        status: EstadoSubasta.INACTIVA,
        deadline: null,
        pujas: [],
      };
    }
    return session;
  }

  // Cliente only sees auctions run by their own company; proveedor only ones
  // they were actually invited to bid on (before or after bidding starts).
  async canView(
    requerimientoId: string,
    viewer: AuctionViewer,
  ): Promise<boolean> {
    if (viewer.portal === 'INTERNO') return false;
    if (viewer.portal === 'CLIENTE') {
      if (!viewer.companyId) return false;
      const requerimiento = await this.prisma.requerimiento.findUnique({
        where: { id: requerimientoId },
        select: { companyId: true },
      });
      return requerimiento?.companyId === viewer.companyId;
    }
    if (!viewer.proveedorId) return false;
    const invitado = await this.prisma.invitacion.findFirst({
      where: {
        requerimientoId,
        proveedorId: viewer.proveedorId,
        enviada: true,
      },
      select: { id: true },
    });
    return !!invitado;
  }

  // Only the cliente company running the process can start/stop its auction.
  async canControl(
    requerimientoId: string,
    viewer: AuctionViewer,
  ): Promise<boolean> {
    if (viewer.portal !== 'CLIENTE' || !viewer.companyId) return false;
    const requerimiento = await this.prisma.requerimiento.findUnique({
      where: { id: requerimientoId },
      select: { companyId: true },
    });
    return requerimiento?.companyId === viewer.companyId;
  }

  /**
   * Cliente/Interno get the real leaderboard. Proveedor gets only their own
   * puja plus a rank/participant count — never a rival's name or amount,
   * matching the "never see rival identities or amounts" product guarantee
   * (previously enforced only client-side, which any devtools user could
   * bypass since the raw data was already on the wire).
   */
  buildView(
    state: Awaited<ReturnType<SubastaService['getState']>>,
    viewer: AuctionViewer,
  ) {
    if (viewer.portal !== 'PROVEEDOR') {
      return state;
    }
    const ordenados = [...state.pujas].sort((a, b) => a.monto - b.monto);
    const miPuja =
      ordenados.find((p) => p.proveedorId === viewer.proveedorId) ?? null;
    const miPosicion = miPuja
      ? ordenados.findIndex((p) => p.proveedorId === viewer.proveedorId) + 1
      : 0;
    return {
      requerimientoId: state.requerimientoId,
      status: state.status,
      deadline: state.deadline,
      miPuja,
      miPosicion,
      totalParticipantes: ordenados.length,
    };
  }

  /**
   * Starting bids come from the proveedores' real, sent offers — never from
   * the browser, which could otherwise invent participants or amounts.
   */
  async iniciar(requerimientoId: string, opciones: IniciarOpciones) {
    if (
      !(DURACIONES_PERMITIDAS_MIN as readonly number[]).includes(
        opciones.duracionMin,
      )
    ) {
      throw new BadRequestException('Duración de ronda no permitida.');
    }
    const actual = await this.getState(requerimientoId);
    if (actual.status === EstadoSubasta.ACTIVA) {
      throw new ConflictException(
        'Ya hay una ronda en curso para este proceso.',
      );
    }

    const ofertas = await this.prisma.oferta.findMany({
      where: { requerimientoId, enviada: true },
      orderBy: { precioTotal: 'asc' },
      take: opciones.participantes === 'finalistas' ? 3 : undefined,
      select: {
        proveedorId: true,
        precioTotal: true,
        proveedor: { select: { nombre: true } },
      },
    });
    if (ofertas.length < 2) {
      throw new BadRequestException(
        'Se necesitan al menos 2 ofertas enviadas para negociar.',
      );
    }

    const deadline = new Date(Date.now() + opciones.duracionMin * 60_000);
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.auctionSession.upsert({
        where: { requerimientoId },
        create: { requerimientoId, status: EstadoSubasta.ACTIVA, deadline },
        update: { status: EstadoSubasta.ACTIVA, deadline },
      });
      await tx.puja.deleteMany({ where: { sessionId: session.id } });
      await tx.puja.createMany({
        data: ofertas.map((o) => ({
          sessionId: session.id,
          proveedorId: o.proveedorId,
          proveedorNombre: o.proveedor.nombre,
          montoInicial: o.precioTotal,
          monto: o.precioTotal,
        })),
      });
    });
    return this.getState(requerimientoId);
  }

  /**
   * One conditional UPDATE: it only lands if the round is still open, before
   * its deadline, and the new amount beats this proveedor's current one. Two
   * near-simultaneous bids can't overwrite a better one, and a bid can't
   * sneak in after closing — the database decides, not a read-then-write.
   */
  async pujar(requerimientoId: string, proveedorId: string, monto: number) {
    if (!Number.isSafeInteger(monto) || monto <= 0) {
      throw new BadRequestException(
        'El monto debe ser un número entero positivo.',
      );
    }
    const { count } = await this.prisma.puja.updateMany({
      where: {
        proveedorId,
        monto: { gt: monto },
        session: {
          requerimientoId,
          status: EstadoSubasta.ACTIVA,
          deadline: { gt: new Date() },
        },
      },
      data: { monto },
    });
    if (count === 0)
      await this.explicarPujaRechazada(requerimientoId, proveedorId);
    return this.getState(requerimientoId);
  }

  private async explicarPujaRechazada(
    requerimientoId: string,
    proveedorId: string,
  ): Promise<never> {
    const session = await this.prisma.auctionSession.findUnique({
      where: { requerimientoId },
      include: { pujas: { where: { proveedorId } } },
    });
    if (
      !session ||
      session.status !== EstadoSubasta.ACTIVA ||
      !session.deadline ||
      session.deadline <= new Date()
    ) {
      throw new ConflictException('La ronda ya no está activa.');
    }
    if (session.pujas.length === 0)
      throw new NotFoundException('No participas en esta subasta.');
    throw new ConflictException('La mejora debe ser menor a tu oferta actual.');
  }

  /** Idempotent: safe to call from every instance and from any read. true = this call closed it. */
  async cerrarSiVencida(requerimientoId: string): Promise<boolean> {
    const { count } = await this.prisma.auctionSession.updateMany({
      where: {
        requerimientoId,
        status: EstadoSubasta.ACTIVA,
        deadline: { lte: new Date() },
      },
      data: { status: EstadoSubasta.CERRADA },
    });
    return count > 0;
  }

  async cerrar(requerimientoId: string) {
    await this.prisma.auctionSession.updateMany({
      where: { requerimientoId, status: EstadoSubasta.ACTIVA },
      data: { status: EstadoSubasta.CERRADA },
    });
    return this.getState(requerimientoId);
  }
}
