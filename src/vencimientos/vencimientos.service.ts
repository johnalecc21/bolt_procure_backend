import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  Contrato,
  EstadoContrato,
  EstadoHito,
  EstadoPago,
  Role,
} from '@prisma/client';
import { DIAS_EN_RIESGO } from '../contratos/contratos.rules';
import * as Sentry from '@sentry/nestjs';
import type { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { formatContratoCodigo } from '../common/utils/codigo.util';

const MS_POR_DIA = 24 * 60 * 60 * 1000;
const UMBRALES = [60, 30, 15] as const;
const LOCK_KEY = 'vencimientos:lock';
const LOCK_TTL_MS = 5 * 60 * 1000;

interface Contadores {
  vencidos: number;
  porVencerNuevos: number;
  recordatoriosEnviados: number;
}

@Injectable()
export class VencimientosService {
  private readonly logger = new Logger(VencimientosService.name);

  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private notificaciones: NotificacionesService,
    @Inject(REDIS_CLIENT) private redis: Redis,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async procesarVencimientos() {
    // @nestjs/schedule has no cluster awareness — every replica would
    // otherwise fire this at 6am simultaneously and double-send every
    // reminder. Only the instance that wins this lock runs today's pass.
    const acquired = await this.redis.set(
      LOCK_KEY,
      '1',
      'PX',
      LOCK_TTL_MS,
      'NX',
    );
    if (!acquired) {
      this.logger.log(
        'Otra instancia ya está procesando vencimientos hoy — se omite esta corrida.',
      );
      return { skipped: true };
    }
    try {
      return await this.procesar();
    } catch (err) {
      // @Cron runs outside the HTTP pipeline, so the global HttpExceptionFilter
      // (and its @SentryExceptionCaptured()) never sees this — capture explicitly.
      Sentry.captureException(err);
      this.logger.error(
        'Falló el procesamiento de vencimientos.',
        err instanceof Error ? err.stack : err,
      );
      throw err;
    } finally {
      await this.redis.del(LOCK_KEY).catch(() => undefined);
    }
  }

  private async procesar() {
    // Payments past their agreed date are persisted as VENCIDO (the screens
    // already show them that way; this keeps reports and filters honest).
    const { count: pagosVencidos } = await this.prisma.pagoPO.updateMany({
      where: {
        estado: EstadoPago.PENDIENTE,
        fechaPagoPactada: { lt: new Date() },
      },
      data: { estado: EstadoPago.VENCIDO },
    });
    if (pagosVencidos > 0)
      this.logger.log(`${pagosVencidos} pagos marcados VENCIDO.`);
    // Milestones: late once their committed day is over, at risk three days
    // before (the screens already show it; this persists it for reports).
    const vivos = { contrato: { estado: { not: EstadoContrato.TERMINADO } } };
    const atrasados = await this.prisma.hitoSeguimiento.updateMany({
      where: {
        ...vivos,
        estado: { in: [EstadoHito.PENDIENTE, EstadoHito.EN_RIESGO] },
        comprometido: { lt: new Date(Date.now() - MS_POR_DIA) },
      },
      data: { estado: EstadoHito.ATRASADO },
    });
    const enRiesgo = await this.prisma.hitoSeguimiento.updateMany({
      where: {
        ...vivos,
        estado: EstadoHito.PENDIENTE,
        comprometido: {
          lte: new Date(Date.now() + DIAS_EN_RIESGO * MS_POR_DIA),
        },
      },
      data: { estado: EstadoHito.EN_RIESGO },
    });
    if (atrasados.count + enRiesgo.count > 0)
      this.logger.log(
        `Hitos: ${atrasados.count} atrasados, ${enRiesgo.count} en riesgo.`,
      );
    const contratos = await this.prisma.contrato.findMany({
      where: {
        estado: { in: [EstadoContrato.ACTIVO, EstadoContrato.POR_VENCER] },
      },
    });
    if (contratos.length === 0) {
      this.logger.log('Vencimientos procesados: 0 contratos revisados.');
      return {
        revisados: 0,
        vencidos: 0,
        porVencerNuevos: 0,
        recordatoriosEnviados: 0,
      };
    }

    // One membership query for every company in this batch instead of one
    // per contract — most companies have several contracts, so this turns
    // O(contratos) lookups into O(empresas distintas).
    const companyIds = [...new Set(contratos.map((c) => c.companyId))];
    const memberships = await this.prisma.companyMembership.findMany({
      where: {
        companyId: { in: companyIds },
        activo: true,
        user: {
          role: { in: [Role.COMPRADOR, Role.ADMIN_CLIENTE] },
          activo: true,
        },
      },
      include: { user: true },
    });
    const responsablesPorEmpresa = new Map<string, string[]>();
    for (const m of memberships) {
      const list = responsablesPorEmpresa.get(m.companyId) ?? [];
      list.push(m.user.id);
      responsablesPorEmpresa.set(m.companyId, list);
    }

    const ahora = Date.now();
    const contadores: Contadores = {
      vencidos: 0,
      porVencerNuevos: 0,
      recordatoriosEnviados: 0,
    };
    // allSettled (not all): one bad contract must not cost the rest of the
    // batch their update for today — each failure is reported individually.
    const resultados = await Promise.allSettled(
      contratos.map((c) =>
        this.procesarContrato(c, ahora, responsablesPorEmpresa, contadores),
      ),
    );
    resultados.forEach((r, i) => {
      if (r.status === 'rejected') {
        Sentry.captureException(r.reason);
        this.logger.error(
          `Falló el procesamiento del contrato ${contratos[i].id}.`,
          r.reason instanceof Error ? r.reason.stack : r.reason,
        );
      }
    });

    this.logger.log(
      `Vencimientos procesados: ${contratos.length} contratos revisados, ${contadores.vencidos} marcados VENCIDO, ${contadores.porVencerNuevos} nuevos POR_VENCER, ${contadores.recordatoriosEnviados} recordatorios enviados.`,
    );
    return { revisados: contratos.length, ...contadores };
  }

  private async procesarContrato(
    contrato: Contrato,
    ahora: number,
    responsablesPorEmpresa: Map<string, string[]>,
    contadores: Contadores,
  ) {
    const diasRestantes = Math.ceil(
      (contrato.vigenciaFin.getTime() - ahora) / MS_POR_DIA,
    );
    const userIds = responsablesPorEmpresa.get(contrato.companyId) ?? [];

    if (diasRestantes < 0) {
      const codigo = formatContratoCodigo(contrato.tipo, contrato.numero);
      await this.prisma.contrato.update({
        where: { id: contrato.id },
        data: { estado: EstadoContrato.VENCIDO },
      });
      await Promise.all([
        this.auditLog.log({
          companyId: contrato.companyId,
          usuario: 'Sistema (cron vencimientos)',
          accion: 'Contrato vencido',
          detalle: `${codigo} venció el ${contrato.vigenciaFin.toISOString().slice(0, 10)}`,
        }),
        ...userIds.map((userId) =>
          this.notificaciones.create(
            userId,
            'CONTRATO',
            'Contrato vencido',
            `${codigo} (${contrato.proveedorNombre}) venció. Si aún se necesita, prorrógalo desde su ficha.`,
            `/cliente/contratos/${contrato.id}`,
          ),
        ),
      ]);
      contadores.vencidos++;
      return;
    }

    const writes: Promise<unknown>[] = [];

    if (diasRestantes <= 30 && contrato.estado === EstadoContrato.ACTIVO) {
      writes.push(
        this.prisma.contrato.update({
          where: { id: contrato.id },
          data: { estado: EstadoContrato.POR_VENCER },
        }),
      );
      contadores.porVencerNuevos++;
    }

    for (const umbral of UMBRALES) {
      const campo = `recordatorio${umbral}Enviado` as
        | 'recordatorio60Enviado'
        | 'recordatorio30Enviado'
        | 'recordatorio15Enviado';
      if (diasRestantes <= umbral && !contrato[campo]) {
        // Conditional updateMany (not update): even if two runs somehow overlap
        // for the same contract, only whichever call actually flips false→true
        // (count === 1) sends the reminder — the loser sees count === 0 and skips.
        writes.push(
          this.prisma.contrato
            .updateMany({
              where: { id: contrato.id, [campo]: false },
              data: { [campo]: true },
            })
            .then((res) => {
              if (res.count === 0) return;
              return Promise.all(
                userIds.map((userId) =>
                  this.notificaciones.create(
                    userId,
                    'CONTRATO',
                    `Vence en ${diasRestantes} días`,
                    `${formatContratoCodigo(contrato.tipo, contrato.numero)} (${contrato.proveedorNombre}) vence el ${contrato.vigenciaFin.toISOString().slice(0, 10)} — quedan ${diasRestantes} días.`,
                    `/cliente/contratos/${contrato.id}`,
                  ),
                ),
              );
            }),
        );
        contadores.recordatoriosEnviados++;
      }
    }

    await Promise.all(writes);
  }
}
