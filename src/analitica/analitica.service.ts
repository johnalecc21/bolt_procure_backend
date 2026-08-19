import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const MS_POR_DIA = 24 * 60 * 60 * 1000;
const MESES_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

@Injectable()
export class AnaliticaService {
  constructor(private prisma: PrismaService) {}

  async resumen(companyId: string) {
    const [ahorroMensual, tiempoCicloCategoria, concentracionGasto, topProveedores] = await Promise.all([
      this.ahorroMensual(companyId),
      this.tiempoCicloCategoria(companyId),
      this.concentracionGasto(companyId),
      this.topProveedores(companyId),
    ]);
    return { ahorroMensual, tiempoCicloCategoria, concentracionGasto, topProveedores };
  }

  /** Last 6 calendar months, oldest first — shared cutoff so every rolling-window metric stays in sync. */
  private ultimosSeisMeses() {
    const ahora = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const offset = 5 - i;
      const start = new Date(ahora.getFullYear(), ahora.getMonth() - offset, 1);
      const end = new Date(ahora.getFullYear(), ahora.getMonth() - offset + 1, 1);
      return { label: MESES_ES[start.getMonth()], start, end };
    });
  }

  /** Real savings (montoEstimado - precioFinal) per signed adjudicación, summed over the last 6 calendar months. */
  private async ahorroMensual(companyId: string) {
    const meses = this.ultimosSeisMeses();

    const adjudicaciones = await this.prisma.adjudicacion.findMany({
      where: { firmado: true, requerimiento: { companyId }, createdAt: { gte: meses[0].start } },
      select: { precioFinal: true, createdAt: true, requerimiento: { select: { montoEstimado: true } } },
    });

    return meses.map(({ label, start, end }) => ({
      mes: label,
      ahorro: adjudicaciones
        .filter((a) => a.createdAt >= start && a.createdAt < end)
        .reduce((sum, a) => sum + (a.requerimiento.montoEstimado - a.precioFinal), 0),
    }));
  }

  /** Average days from requerimiento creation to signed adjudicación, per category, over the last 6 calendar months. */
  private async tiempoCicloCategoria(companyId: string) {
    const meses = this.ultimosSeisMeses();
    const adjudicaciones = await this.prisma.adjudicacion.findMany({
      where: { firmado: true, requerimiento: { companyId }, createdAt: { gte: meses[0].start } },
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
  private async concentracionGasto(companyId: string) {
    const grupos = await this.prisma.contrato.groupBy({
      by: ['categoria'],
      where: { companyId },
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

  private async topProveedores(companyId: string) {
    const grupos = await this.prisma.contrato.groupBy({
      by: ['proveedorNombre'],
      where: { companyId },
      _sum: { monto: true },
      orderBy: { _sum: { monto: 'desc' } },
      take: 5,
    });
    return grupos.map((g) => ({ proveedor: g.proveedorNombre, gasto: g._sum.monto ?? 0 }));
  }
}
