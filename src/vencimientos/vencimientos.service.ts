import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Contrato, EstadoContrato, Role } from '@prisma/client';
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
    const acquired = await this.redis.set(LOCK_KEY, '1', 'PX', LOCK_TTL_MS, 'NX');
    if (!acquired) {
      this.logger.log('Otra instancia ya está procesando vencimientos hoy — se omite esta corrida.');
      return { skipped: true };
    }
    try {
      return await this.procesar();
    } finally {
      await this.redis.del(LOCK_KEY).catch(() => undefined);
    }
  }

  private async procesar() {
    const contratos = await this.prisma.contrato.findMany({
      where: { estado: { in: [EstadoContrato.ACTIVO, EstadoContrato.POR_VENCER] } },
    });
    if (contratos.length === 0) {
      this.logger.log('Vencimientos procesados: 0 contratos revisados.');
      return { revisados: 0, vencidos: 0, porVencerNuevos: 0, recordatoriosEnviados: 0 };
    }

    // One membership query for every company in this batch instead of one
    // per contract — most companies have several contracts, so this turns
    // O(contratos) lookups into O(empresas distintas).
    const companyIds = [...new Set(contratos.map((c) => c.companyId))];
    const memberships = await this.prisma.companyMembership.findMany({
      where: {
        companyId: { in: companyIds },
        activo: true,
        user: { role: { in: [Role.COMPRADOR, Role.ADMIN_CLIENTE] }, activo: true },
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
    const contadores: Contadores = { vencidos: 0, porVencerNuevos: 0, recordatoriosEnviados: 0 };
    await Promise.all(contratos.map((c) => this.procesarContrato(c, ahora, responsablesPorEmpresa, contadores)));

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
    const diasRestantes = Math.ceil((contrato.vigenciaFin.getTime() - ahora) / MS_POR_DIA);
    const userIds = responsablesPorEmpresa.get(contrato.companyId) ?? [];

    if (diasRestantes < 0) {
      const codigo = formatContratoCodigo(contrato.tipo, contrato.numero);
      await this.prisma.contrato.update({ where: { id: contrato.id }, data: { estado: EstadoContrato.VENCIDO } });
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
            `${codigo} (${contrato.proveedorNombre}) venció y sigue en estado activo. Revisa si requiere renovación.`,
            '/cliente/contratos',
          ),
        ),
      ]);
      contadores.vencidos++;
      return;
    }

    const writes: Promise<unknown>[] = [];

    if (diasRestantes <= 30 && contrato.estado === EstadoContrato.ACTIVO) {
      writes.push(this.prisma.contrato.update({ where: { id: contrato.id }, data: { estado: EstadoContrato.POR_VENCER } }));
      contadores.porVencerNuevos++;
    }

    for (const umbral of UMBRALES) {
      const campo = `recordatorio${umbral}Enviado` as 'recordatorio60Enviado' | 'recordatorio30Enviado' | 'recordatorio15Enviado';
      if (diasRestantes <= umbral && !contrato[campo]) {
        // Conditional updateMany (not update): even if two runs somehow overlap
        // for the same contract, only whichever call actually flips false→true
        // (count === 1) sends the reminder — the loser sees count === 0 and skips.
        writes.push(
          this.prisma.contrato
            .updateMany({ where: { id: contrato.id, [campo]: false }, data: { [campo]: true } })
            .then((res) => {
              if (res.count === 0) return;
              return Promise.all(
                userIds.map((userId) =>
                  this.notificaciones.create(
                    userId,
                    'CONTRATO',
                    `Vence en ${diasRestantes} días`,
                    `${formatContratoCodigo(contrato.tipo, contrato.numero)} (${contrato.proveedorNombre}) vence el ${contrato.vigenciaFin.toISOString().slice(0, 10)} — quedan ${diasRestantes} días.`,
                    '/cliente/contratos',
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
