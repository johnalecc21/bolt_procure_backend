import { Injectable, NotFoundException } from '@nestjs/common';
import { EstadoSubasta } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProveedoresService } from '../proveedores/proveedores.service';

export interface PujaSeed {
  proveedorId: string;
  proveedorNombre: string;
  monto: number;
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
    const session = await this.prisma.auctionSession.findUnique({
      where: { requerimientoId },
      include: { pujas: true },
    });
    if (!session) {
      return { requerimientoId, status: EstadoSubasta.INACTIVA, deadline: null, pujas: [] };
    }
    return session;
  }

  // Cliente only sees auctions run by their own company; proveedor only ones
  // they were actually invited to bid on (before or after bidding starts).
  async canView(requerimientoId: string, viewer: AuctionViewer): Promise<boolean> {
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
      where: { requerimientoId, proveedorId: viewer.proveedorId, enviada: true },
      select: { id: true },
    });
    return !!invitado;
  }

  // Only the cliente company running the process can start/stop its auction.
  async canControl(requerimientoId: string, viewer: AuctionViewer): Promise<boolean> {
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
  buildView(state: Awaited<ReturnType<SubastaService['getState']>>, viewer: AuctionViewer) {
    if (viewer.portal !== 'PROVEEDOR') {
      return state;
    }
    const ordenados = [...state.pujas].sort((a, b) => a.monto - b.monto);
    const miPuja = ordenados.find((p) => p.proveedorId === viewer.proveedorId) ?? null;
    const miPosicion = miPuja ? ordenados.findIndex((p) => p.proveedorId === viewer.proveedorId) + 1 : 0;
    return {
      requerimientoId: state.requerimientoId,
      status: state.status,
      deadline: state.deadline,
      miPuja,
      miPosicion,
      totalParticipantes: ordenados.length,
    };
  }

  async iniciar(requerimientoId: string, durationMs: number, seed: PujaSeed[]) {
    const deadline = new Date(Date.now() + durationMs);
    const session = await this.prisma.auctionSession.upsert({
      where: { requerimientoId },
      create: { requerimientoId, status: EstadoSubasta.ACTIVA, deadline },
      update: { status: EstadoSubasta.ACTIVA, deadline },
    });
    await this.prisma.puja.deleteMany({ where: { sessionId: session.id } });
    await this.prisma.puja.createMany({
      data: seed.map((p) => ({
        sessionId: session.id,
        proveedorId: p.proveedorId,
        proveedorNombre: p.proveedorNombre,
        montoInicial: p.monto,
        monto: p.monto,
      })),
    });
    return this.getState(requerimientoId);
  }

  async nudge(requerimientoId: string) {
    const session = await this.prisma.auctionSession.findUnique({
      where: { requerimientoId },
      include: { pujas: true },
    });
    if (!session || session.status !== EstadoSubasta.ACTIVA || session.pujas.length === 0) return null;
    const idx = Math.floor(Math.random() * session.pujas.length);
    const target = session.pujas[idx];
    const nudgeAmount = Math.round((500 + Math.random() * 2500) / 100) * 100;
    await this.prisma.puja.update({
      where: { id: target.id },
      data: { monto: Math.max(1000, target.monto - nudgeAmount) },
    });
    return this.getState(requerimientoId);
  }

  async pujar(requerimientoId: string, proveedorId: string, monto: number) {
    const session = await this.prisma.auctionSession.findUnique({ where: { requerimientoId } });
    if (!session || session.status !== EstadoSubasta.ACTIVA) {
      throw new NotFoundException('No hay una subasta activa para este requerimiento.');
    }
    const puja = await this.prisma.puja.findUnique({
      where: { sessionId_proveedorId: { sessionId: session.id, proveedorId } },
    });
    if (!puja) throw new NotFoundException('No participas en esta subasta.');
    if (monto >= puja.monto) {
      throw new NotFoundException('La mejora debe ser menor a tu oferta actual.');
    }
    await this.prisma.puja.update({ where: { id: puja.id }, data: { monto } });
    return this.getState(requerimientoId);
  }

  async cerrar(requerimientoId: string) {
    await this.prisma.auctionSession.update({
      where: { requerimientoId },
      data: { status: EstadoSubasta.CERRADA },
    });
    return this.getState(requerimientoId);
  }
}
