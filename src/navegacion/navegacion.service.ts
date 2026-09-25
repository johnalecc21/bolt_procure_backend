import { Injectable } from '@nestjs/common';
import {
  EstadoAprobacion,
  EstadoDocumento,
  EstadoFactura,
  EstadoHomologacion,
  EstadoInvitacion,
  EstadoPago,
  EstadoProntoPago,
  Portal,
  Role,
  TipoRegla,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProveedoresService } from '../proveedores/proveedores.service';
import type { AuthenticatedUser } from '../auth/types';

/** Roles that work the payables screen. */
const CXP: Role[] = [Role.COMPRADOR, Role.ADMIN_CLIENTE, Role.APROBADOR_CFO];

/**
 * Small "pending" counters for the side menu, one cheap call per portal:
 * what is waiting on this user right now.
 */
@Injectable()
export class NavegacionService {
  constructor(
    private prisma: PrismaService,
    private proveedores: ProveedoresService,
  ) {}

  async contadores(
    user: AuthenticatedUser,
  ): Promise<Record<string, number | boolean>> {
    if (user.portal === Portal.PROVEEDOR) return this.proveedor(user.sub);
    if (user.portal === Portal.INTERNO) return this.interno(user.role);
    return this.cliente(user.companyId, user.role);
  }

  private async cliente(companyId: string, role: Role) {
    const [pendientes, facturas, pronto, usuarios, reglas, requerimientos] =
      await Promise.all([
        this.prisma.aprobacion.findMany({
          where: {
            estado: EstadoAprobacion.PENDIENTE,
            requerimiento: { companyId },
          },
          select: { tipoRegla: true, rolesRequeridos: true, pasoActual: true },
        }),
        CXP.includes(role)
          ? this.prisma.factura.count({
              where: {
                estado: EstadoFactura.RADICADA,
                pago: { contrato: { companyId } },
              },
            })
          : 0,
        CXP.includes(role)
          ? this.prisma.solicitudProntoPago.count({
              where: {
                estado: EstadoProntoPago.SOLICITADA,
                pago: { contrato: { companyId } },
              },
            })
          : 0,
        this.prisma.companyMembership.count({
          where: { companyId, user: { activo: true } },
        }),
        this.prisma.matrizAprobacionRegla.count({ where: { companyId } }),
        this.prisma.requerimiento.count({ where: { companyId } }),
      ]);
    // Same rule as the approvals inbox: sequential rules wait on one role.
    const aprobaciones = pendientes.filter((a) =>
      a.tipoRegla === TipoRegla.SECUENCIAL
        ? a.rolesRequeridos[a.pasoActual] === role
        : a.rolesRequeridos.includes(role),
    ).length;
    return {
      aprobaciones,
      cuentasPorPagar: facturas + pronto,
      // The setup wizard's required steps (the cost centers one is optional).
      onboardingCompleto: usuarios > 1 && reglas > 0 && requerimientos > 0,
    };
  }

  private async proveedor(userId: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const [invitaciones, porFacturar] = await Promise.all([
      this.prisma.invitacion.count({
        where: { proveedorId, enviada: true, estado: EstadoInvitacion.NUEVA },
      }),
      this.prisma.pagoPO.count({
        where: {
          proveedorId,
          estado: { not: EstadoPago.PAGADO },
          facturas: {
            none: {
              estado: { in: [EstadoFactura.RADICADA, EstadoFactura.APROBADA] },
            },
          },
        },
      }),
    ]);
    return { invitaciones, pagos: porFacturar };
  }

  private async interno(role: Role): Promise<Record<string, number>> {
    if (role !== Role.COMPLIANCE_OPS) return {};
    const homologacion = await this.prisma.homologacion.count({
      where: {
        OR: [
          {
            estado: {
              in: [
                EstadoHomologacion.EN_REVISION,
                EstadoHomologacion.ZONA_GRIS,
              ],
            },
          },
          {
            estado: EstadoHomologacion.APROBADO,
            documentos: { some: { estado: EstadoDocumento.SUBIDO } },
          },
        ],
      },
    });
    return { homologacion };
  }
}
