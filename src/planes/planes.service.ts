import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  BYTES_POR_MB,
  dentroDelLimite,
  inicioDeMes,
  LIMITES_PLAN,
  NOMBRE_PLAN,
} from './planes.constants';

/**
 * Plan limits per client company. Checked right before the action that
 * would exceed them (inviting a user, creating a requerimiento, uploading a
 * file) so the error explains exactly what to do.
 */
@Injectable()
export class PlanesService {
  constructor(private prisma: PrismaService) {}

  async uso(companyId: string) {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { plan: true },
    });
    const [usuarios, requerimientosMes, almacenamientoBytes] =
      await Promise.all([
        this.usuariosActivos(companyId),
        this.requerimientosDelMes(companyId),
        this.almacenamientoUsado(companyId),
      ]);
    const limites = LIMITES_PLAN[company.plan];
    return {
      plan: company.plan,
      planNombre: NOMBRE_PLAN[company.plan],
      limites,
      uso: {
        usuarios,
        requerimientosMes,
        almacenamientoMb:
          Math.round((almacenamientoBytes / BYTES_POR_MB) * 10) / 10,
      },
    };
  }

  async verificarUsuarios(companyId: string) {
    const { limites, plan } = await this.limites(companyId);
    const usados = await this.usuariosActivos(companyId);
    if (!dentroDelLimite(limites.usuarios, usados)) {
      throw new ForbiddenException(
        `Tu plan ${NOMBRE_PLAN[plan]} permite ${limites.usuarios} usuarios activos. Desactiva alguno o mejora tu plan.`,
      );
    }
  }

  async verificarRequerimientoDelMes(companyId: string) {
    const { limites, plan } = await this.limites(companyId);
    const usados = await this.requerimientosDelMes(companyId);
    if (!dentroDelLimite(limites.requerimientosMes, usados)) {
      throw new ForbiddenException(
        `Tu plan ${NOMBRE_PLAN[plan]} permite ${limites.requerimientosMes} requerimientos por mes. Mejora tu plan para crear más.`,
      );
    }
  }

  async verificarAlmacenamiento(companyId: string, tamanoBytes: number) {
    const { limites, plan } = await this.limites(companyId);
    if (limites.almacenamientoMb === null) return;
    const usados = await this.almacenamientoUsado(companyId);
    if (
      !dentroDelLimite(
        limites.almacenamientoMb * BYTES_POR_MB,
        usados,
        tamanoBytes,
      )
    ) {
      throw new ForbiddenException(
        `Superarías el almacenamiento de tu plan ${NOMBRE_PLAN[plan]} (${limites.almacenamientoMb} MB). Elimina archivos o mejora tu plan.`,
      );
    }
  }

  private async limites(companyId: string) {
    const { plan } = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { plan: true },
    });
    return { plan, limites: LIMITES_PLAN[plan] };
  }

  private usuariosActivos(companyId: string) {
    return this.prisma.companyMembership.count({
      where: { companyId, activo: true, user: { activo: true } },
    });
  }

  private requerimientosDelMes(companyId: string) {
    return this.prisma.requerimiento.count({
      where: { companyId, createdAt: { gte: inicioDeMes() } },
    });
  }

  /** Files the company itself uploads: requerimiento attachments and its own contract/PO documents. */
  private async almacenamientoUsado(companyId: string): Promise<number> {
    const [docs, contratos] = await Promise.all([
      this.prisma.documentoRequerimiento.aggregate({
        where: { requerimiento: { companyId }, storagePath: { not: null } },
        _sum: { tamanoBytes: true },
      }),
      this.prisma.contrato.aggregate({
        where: { companyId, archivoStoragePath: { not: null } },
        _sum: { archivoTamanoBytes: true },
      }),
    ]);
    return (
      (docs._sum.tamanoBytes ?? 0) + (contratos._sum.archivoTamanoBytes ?? 0)
    );
  }
}
