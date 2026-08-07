import { Injectable, NotFoundException } from '@nestjs/common';
import { EstadoSubasta } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface PujaSeed {
  proveedorId: string;
  proveedorNombre: string;
  monto: number;
}

@Injectable()
export class SubastaService {
  constructor(private prisma: PrismaService) {}

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
