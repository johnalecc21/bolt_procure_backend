import { Injectable } from '@nestjs/common';
import { Moneda } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const MS_POR_DIA = 24 * 60 * 60 * 1000;
const MESES_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

@Injectable()
export class AnaliticaService {
  constructor(private prisma: PrismaService) {}

  /**
   * Money aggregates only include amounts in the company's monedaBase —
   * summing COP and USD together would be meaningless, and there's no FX
   * source to convert with. Cycle time isn't monetary, so it covers all.
   */
  async resumen(companyId: string) {
    const { monedaBase: moneda } = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { monedaBase: true },
    });
    const [ahorroMensual, tiempoCicloCategoria, concentracionGasto, topProveedores] = await Promise.all([
      this.ahorroMensual(companyId, moneda),
      this.tiempoCicloCategoria(companyId),
      this.concentracionGasto(companyId, moneda),
      this.topProveedores(companyId, moneda),
    ]);
    return { moneda, ahorroMensual, tiempoCicloCategoria, concentracionGasto, topProveedores };
  }

  /** Real savings (montoEstimado - precioFinal) per signed adjudicación, summed over the last 6 calendar months. */
  private async ahorroMensual(companyId: string, moneda: Moneda) {
    const ahora = new Date();
    const meses = Array.from({ length: 6 }, (_, i) => {
      const offset = 5 - i;
      const start = new Date(ahora.getFullYear(), ahora.getMonth() - offset, 1);
      const end = new Date(ahora.getFullYear(), ahora.getMonth() - offset + 1, 1);
      return { label: MESES_ES[start.getMonth()], start, end };
    });

    const adjudicaciones = await this.prisma.adjudicacion.findMany({
      where: { firmado: true, requerimiento: { companyId, moneda }, createdAt: { gte: meses[0].start } },
      select: { precioFinal: true, createdAt: true, requerimiento: { select: { montoEstimado: true } } },
    });

    return meses.map(({ label, start, end }) => ({
      mes: label,
      ahorro: adjudicaciones
        .filter((a) => a.createdAt >= start && a.createdAt < end)
        .reduce((sum, a) => sum + (a.requerimiento.montoEstimado - a.precioFinal), 0),
    }));
  }

  /** Average days from requerimiento creation to signed adjudicación, per category. */
  private async tiempoCicloCategoria(companyId: string) {
    const adjudicaciones = await this.prisma.adjudicacion.findMany({
      where: { firmado: true, requerimiento: { companyId } },
      select: { createdAt: true, requerimiento: { select: { categoria: true, createdAt: true } } },
    });

    const porCategoria = new Map<string, { totalDias: number; count: number }>();
    for (const a of adjudicaciones) {
      const dias = Math.max(0, Math.round((a.createdAt.getTime() - a.requerimiento.createdAt.getTime()) / MS_POR_DIA));
      const acc = porCategoria.get(a.requerimiento.categoria) ?? { totalDias: 0, count: 0 };
      acc.totalDias += dias;
      acc.count += 1;
      porCategoria.set(a.requerimiento.categoria, acc);
    }

    return Array.from(porCategoria.entries())
      .map(([categoria, { totalDias, count }]) => ({ categoria, dias: Math.round(totalDias / count) }))
      .sort((a, b) => b.dias - a.dias);
  }

  /** Real spend concentration by category, from signed contracts. */
  private async concentracionGasto(companyId: string, moneda: Moneda) {
    const grupos = await this.prisma.contrato.groupBy({
      by: ['categoria'],
      where: { companyId, moneda },
      _sum: { monto: true },
    });
    const total = grupos.reduce((sum, g) => sum + (g._sum.monto ?? 0), 0);
    return grupos
      .map((g) => ({
        categoria: g.categoria,
        monto: g._sum.monto ?? 0,
        porcentaje: total ? Math.round(((g._sum.monto ?? 0) / total) * 100) : 0,
      }))
      .sort((a, b) => b.monto - a.monto);
  }

  private async topProveedores(companyId: string, moneda: Moneda) {
    const grupos = await this.prisma.contrato.groupBy({
      by: ['proveedorNombre'],
      where: { companyId, moneda },
      _sum: { monto: true },
      orderBy: { _sum: { monto: 'desc' } },
      take: 5,
    });
    return grupos.map((g) => ({ proveedor: g.proveedorNombre, gasto: g._sum.monto ?? 0 }));
  }
}
