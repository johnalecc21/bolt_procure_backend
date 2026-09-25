import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  EstadoAlertaRiesgo,
  EstadoContrato,
  EstadoDocumento,
  EstadoHomologacion,
  ResultadoLista,
  Role,
  TipoAlertaRiesgo,
} from '@prisma/client';
import type { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ListasRestrictivasService } from './listas-restrictivas.service';

const LOCK = 'riesgo:monitoreo:lock';
const MS_DIA = 86_400_000;
/** Days before expiry when the supplier is reminded (once each). */
export const AVISOS_VENCIMIENTO = [30, 15, 7];
/** How often an approved supplier is re-screened against OFAC/ONU. */
export const DIAS_ENTRE_MONITOREOS = 30;
const LOTE_LISTAS = 50;
const AUTOMATICAS = ['OFAC', 'ONU'];

/** Which reminder threshold a document is at, or null (none due). */
export function umbralAviso(dias: number): number | null {
  const u = AVISOS_VENCIMIENTO.filter((a) => dias <= a);
  return u.length ? Math.min(...u) : null;
}

/**
 * Continuous supplier risk: an approved homologación is not checked once and
 * forgotten. Every day documents are watched for expiry, approved suppliers
 * are re-screened against the automated restrictive lists every 30 days and
 * due re-evaluations are flagged. Findings become alerts Compliance resolves.
 */
@Injectable()
export class RiesgoService {
  private readonly logger = new Logger(RiesgoService.name);

  constructor(
    private prisma: PrismaService,
    private notificaciones: NotificacionesService,
    private auditLog: AuditLogService,
    private listas: ListasRestrictivasService,
    @Inject(REDIS_CLIENT) private redis: Redis,
  ) {}

  @Cron('0 15 4 * * *')
  async programado() {
    const ok = await this.redis.set(LOCK, '1', 'PX', 60 * 60_000, 'NX');
    if (!ok) return;
    try {
      const r = await this.ejecutar();
      this.logger.log(`Monitoreo de riesgo: ${JSON.stringify(r)}`);
    } catch (err) {
      this.logger.error(
        'Falló el monitoreo de riesgo',
        err instanceof Error ? err.stack : err,
      );
    } finally {
      await this.redis.del(LOCK).catch(() => undefined);
    }
  }

  async ejecutar(ahora = new Date()) {
    const documentos = await this.documentos(ahora);
    const listas = await this.monitorearListas(ahora);
    const revalidaciones = await this.revalidaciones(ahora);
    return { ...documentos, ...listas, revalidaciones };
  }

  // ------------------------------------------------------------ documentos

  private async documentos(ahora: Date) {
    const docs = await this.prisma.documentoHomologacion.findMany({
      where: {
        vigencia: { not: null, lte: new Date(ahora.getTime() + 31 * MS_DIA) },
        estado: { in: [EstadoDocumento.VALIDADO, EstadoDocumento.SUBIDO] },
        homologacion: { estado: EstadoHomologacion.APROBADO },
      },
      include: {
        homologacion: {
          select: {
            proveedor: { select: { id: true, nombre: true, userId: true } },
          },
        },
      },
      take: 2000,
    });
    let vencidos = 0;
    let avisos = 0;
    for (const d of docs) {
      const p = d.homologacion.proveedor;
      const dias = Math.ceil(
        (d.vigencia!.getTime() - ahora.getTime()) / MS_DIA,
      );
      if (dias <= 0) {
        await this.prisma.documentoHomologacion.update({
          where: { id: d.id },
          data: { estado: EstadoDocumento.VENCIDO, avisoVencimiento: 0 },
        });
        await this.alertar(
          p.id,
          TipoAlertaRiesgo.DOCUMENTO_VENCIDO,
          `"${d.nombre}" venció el ${d.vigencia!.toISOString().slice(0, 10)}.`,
          d.id,
        );
        if (p.userId)
          await this.notificaciones.create(
            p.userId,
            'PROVEEDOR',
            'Documento vencido',
            `"${d.nombre}" venció. Súbelo actualizado para seguir cumpliendo los requisitos de las empresas que lo exigen.`,
            '/proveedor/homologacion',
          );
        vencidos++;
        continue;
      }
      const umbral = umbralAviso(dias);
      if (
        umbral == null ||
        (d.avisoVencimiento != null && d.avisoVencimiento <= umbral)
      )
        continue;
      await this.prisma.documentoHomologacion.update({
        where: { id: d.id },
        data: { avisoVencimiento: umbral },
      });
      if (p.userId)
        await this.notificaciones.create(
          p.userId,
          'PROVEEDOR',
          `Documento por vencer en ${dias} día(s)`,
          `"${d.nombre}" vence el ${d.vigencia!.toISOString().slice(0, 10)}. Ten listo el documento actualizado: el día que venza podrás subirlo y Compliance lo validará para que no pierdas oportunidades.`,
          '/proveedor/homologacion',
        );
      avisos++;
    }
    return { documentosVencidos: vencidos, avisosVencimiento: avisos };
  }

  // ----------------------------------------------------------------- listas

  private async monitorearListas(ahora: Date) {
    const pendientes = await this.prisma.homologacion.findMany({
      where: {
        estado: EstadoHomologacion.APROBADO,
        OR: [
          { ultimoMonitoreo: null },
          {
            ultimoMonitoreo: {
              lt: new Date(ahora.getTime() - DIAS_ENTRE_MONITOREOS * MS_DIA),
            },
          },
        ],
      },
      include: {
        proveedor: { include: { user: { select: { nombre: true } } } },
        verificaciones: true,
      },
      orderBy: { ultimoMonitoreo: { sort: 'asc', nulls: 'first' } },
      take: LOTE_LISTAS,
    });
    let consultados = 0;
    let coincidencias = 0;
    for (const h of pendientes) {
      const resultados = (
        await this.listas.verificar(
          [h.proveedor.nombre, h.proveedor.user?.nombre ?? ''],
          h.proveedor.ubicacion,
        )
      ).filter((r) => AUTOMATICAS.includes(r.lista));
      // A list that didn't answer is retried tomorrow; nothing is assumed clean.
      if (resultados.some((r) => r.resultado === ResultadoLista.NO_DISPONIBLE))
        continue;
      consultados++;
      const nuevas = resultados.filter(
        (r) =>
          r.resultado === ResultadoLista.COINCIDENCIA &&
          h.verificaciones.find((v) => v.lista === r.lista)?.resultado !==
            ResultadoLista.COINCIDENCIA,
      );
      await this.prisma.$transaction([
        ...resultados.map((r) =>
          this.prisma.verificacionLista.upsert({
            where: {
              homologacionId_lista: { homologacionId: h.id, lista: r.lista },
            },
            create: {
              homologacionId: h.id,
              lista: r.lista,
              resultado: r.resultado,
              detalle: r.detalle,
              verificadoPor: 'Monitoreo automático',
            },
            update: {
              resultado: r.resultado,
              detalle: r.detalle,
              verificadoPor: 'Monitoreo automático',
            },
          }),
        ),
        this.prisma.homologacion.update({
          where: { id: h.id },
          data: {
            ultimoMonitoreo: ahora,
            // A new hit sends the supplier back to Compliance: while in
            // review it can't be invited to new processes.
            ...(nuevas.length
              ? {
                  estado: EstadoHomologacion.ZONA_GRIS,
                  alertas: [
                    ...h.alertas,
                    ...nuevas.map((n) => n.detalle ?? n.lista),
                  ],
                }
              : {}),
          },
        }),
      ]);
      if (nuevas.length) {
        coincidencias++;
        await this.alertar(
          h.proveedorId,
          TipoAlertaRiesgo.LISTA_RESTRICTIVA,
          nuevas.map((n) => n.detalle ?? n.lista).join(' '),
        );
        await this.auditLog.log({
          usuario: 'Monitoreo automático',
          accion: 'Proveedor enviado a revisión por listas restrictivas',
          detalle: h.proveedor.nombre,
        });
        await this.avisarCompliance(
          'Posible coincidencia en listas restrictivas',
          `${h.proveedor.nombre} tuvo una posible coincidencia en el monitoreo periódico y quedó en revisión.`,
        );
        await this.avisarClientes(h.proveedorId, h.proveedor.nombre);
      }
    }
    return {
      proveedoresMonitoreados: consultados,
      nuevasCoincidencias: coincidencias,
    };
  }

  // ---------------------------------------------------------- revalidación

  private async revalidaciones(ahora: Date) {
    const vencidas = await this.prisma.homologacion.findMany({
      where: {
        estado: EstadoHomologacion.APROBADO,
        proximaRevalidacion: { lte: ahora },
        proveedor: {
          alertasRiesgo: {
            none: {
              tipo: TipoAlertaRiesgo.REVALIDACION,
              estado: EstadoAlertaRiesgo.ABIERTA,
            },
          },
        },
      },
      include: {
        proveedor: { select: { id: true, nombre: true, userId: true } },
      },
      take: 500,
    });
    for (const h of vencidas) {
      await this.alertar(
        h.proveedorId,
        TipoAlertaRiesgo.REVALIDACION,
        `La reevaluación periódica venció el ${h.proximaRevalidacion!.toISOString().slice(0, 10)}.`,
      );
      if (h.proveedor.userId)
        await this.notificaciones.create(
          h.proveedor.userId,
          'PROVEEDOR',
          'Es momento de renovar tu homologación',
          'Actualiza tus documentos y envía de nuevo tu homologación: así sigues visible y elegible para todas las empresas de Procurex.',
          '/proveedor/homologacion',
        );
    }
    return vencidas.length;
  }

  // ---------------------------------------------------------------- alertas

  private async alertar(
    proveedorId: string,
    tipo: TipoAlertaRiesgo,
    detalle: string,
    documentoId?: string,
  ) {
    const abierta = await this.prisma.alertaRiesgo.findFirst({
      where: {
        proveedorId,
        tipo,
        estado: EstadoAlertaRiesgo.ABIERTA,
        documentoId: documentoId ?? null,
      },
    });
    if (abierta) return abierta;
    return this.prisma.alertaRiesgo.create({
      data: { proveedorId, tipo, detalle, documentoId: documentoId ?? null },
    });
  }

  private async avisarCompliance(titulo: string, desc: string) {
    const equipo = await this.prisma.user.findMany({
      where: { role: Role.COMPLIANCE_OPS, activo: true },
      select: { id: true },
    });
    for (const u of equipo)
      await this.notificaciones.create(
        u.id,
        'PROVEEDOR',
        titulo,
        desc,
        '/interno/riesgo',
      );
  }

  /** Buyers with live contracts learn the supplier is under review — never why. */
  private async avisarClientes(proveedorId: string, nombre: string) {
    const contratos = await this.prisma.contrato.findMany({
      where: {
        proveedorId,
        estado: { not: EstadoContrato.TERMINADO },
      },
      select: { companyId: true },
      distinct: ['companyId'],
    });
    for (const c of contratos) {
      const admins = await this.prisma.companyMembership.findMany({
        where: {
          companyId: c.companyId,
          user: {
            role: { in: [Role.ADMIN_CLIENTE, Role.COMPRADOR] },
            activo: true,
          },
        },
        select: { userId: true },
      });
      for (const a of admins)
        await this.notificaciones.create(
          a.userId,
          'PROVEEDOR',
          'Proveedor en revisión de compliance',
          `${nombre}, con quien tienes contratos vigentes, quedó en revisión por el monitoreo periódico de Procurex. No podrá ser invitado a nuevos procesos hasta que se resuelva.`,
          '/cliente/directorio',
        );
    }
  }

  listar(estado?: EstadoAlertaRiesgo) {
    return this.prisma.alertaRiesgo.findMany({
      where: estado ? { estado } : {},
      include: {
        proveedor: {
          select: {
            id: true,
            nombre: true,
            homologacion: { select: { estado: true } },
          },
        },
      },
      orderBy: [{ estado: 'asc' }, { createdAt: 'desc' }],
      take: 300,
    });
  }

  async resolver(id: string, resolucion: string, actor: string) {
    const a = await this.prisma.alertaRiesgo.findUnique({
      where: { id },
      include: { proveedor: { select: { nombre: true } } },
    });
    if (!a) throw new NotFoundException('Alerta no encontrada.');
    const r = await this.prisma.alertaRiesgo.update({
      where: { id },
      data: {
        estado: EstadoAlertaRiesgo.RESUELTA,
        resolucion,
        resueltaPor: actor,
        resueltaAt: new Date(),
      },
    });
    await this.auditLog.log({
      usuario: actor,
      accion: 'Alerta de riesgo resuelta',
      detalle: `${a.proveedor.nombre} — ${a.tipo}`,
      motivo: resolucion,
    });
    return r;
  }

  /** What a buyer sees about a supplier's monitoring (never list details). */
  async resumenProveedor(proveedorId: string) {
    const [h, abiertas] = await Promise.all([
      this.prisma.homologacion.findUnique({
        where: { proveedorId },
        select: {
          estado: true,
          ultimoMonitoreo: true,
          proximaRevalidacion: true,
        },
      }),
      this.prisma.alertaRiesgo.findMany({
        where: { proveedorId, estado: EstadoAlertaRiesgo.ABIERTA },
        select: { tipo: true, detalle: true, createdAt: true },
      }),
    ]);
    return {
      estado: h?.estado ?? null,
      ultimoMonitoreo: h?.ultimoMonitoreo ?? null,
      proximaRevalidacion: h?.proximaRevalidacion ?? null,
      alertas: abiertas.map((a) => ({
        tipo: a.tipo,
        detalle:
          a.tipo === TipoAlertaRiesgo.LISTA_RESTRICTIVA
            ? 'En revisión de compliance.'
            : a.detalle,
        desde: a.createdAt,
      })),
    };
  }

  /** The supplier's own open alerts (documents and re-evaluation only). */
  async mias(proveedorId: string) {
    return this.prisma.alertaRiesgo.findMany({
      where: {
        proveedorId,
        estado: EstadoAlertaRiesgo.ABIERTA,
        tipo: { not: TipoAlertaRiesgo.LISTA_RESTRICTIVA },
      },
      select: { id: true, tipo: true, detalle: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
