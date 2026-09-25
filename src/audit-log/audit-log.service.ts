import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import type { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { paginate } from '../common/dto/pagination.dto';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { CSV_ENCABEZADO, csvFila, fechaCorte, RETENCION_DEFAULT_MESES } from './audit-csv.util';
import { reportarFallo } from '../common/logging/reportar';

export interface LogAuditInput {
  // Omit only for actions with no company involved at all (e.g. Interno
  // resolving a proveedor's homologación) — those rows are then visible
  // only from the unscoped Interno view, never to any cliente company.
  companyId?: string;
  usuarioId?: string;
  usuario: string;
  accion: string;
  detalle: string;
  motivo?: string;
}

const LOTE_EXPORT = 1000;
const LOCK_KEY = 'auditoria:retencion:lock';
const LOCK_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(REDIS_CLIENT) private redis: Redis,
  ) {}

  log(input: LogAuditInput) {
    return this.prisma.auditLogEntry.create({ data: input });
  }

  /** `companyId: null` means unscoped — only Interno callers may pass that. */
  async list(companyId: string | null, page: number, limit: number) {
    const where = companyId ? { companyId } : undefined;
    const [items, total] = await Promise.all([
      this.prisma.auditLogEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLogEntry.count({ where }),
    ]);
    return paginate(items, total, page, limit);
  }

  /**
   * Streams the trail as CSV in id-ordered batches, so exporting years of
   * history never loads it all into memory. UTF-8 BOM so Excel opens accents right.
   */
  async *exportarCsv(companyId: string | null, desde?: Date, hasta?: Date): AsyncGenerator<string> {
    const where: Prisma.AuditLogEntryWhereInput = {
      ...(companyId ? { companyId } : {}),
      ...(desde || hasta ? { createdAt: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) } } : {}),
    };
    yield '﻿' + CSV_ENCABEZADO.join(',') + '\n';
    let cursor: string | undefined;
    for (;;) {
      const lote = await this.prisma.auditLogEntry.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: LOTE_EXPORT,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (lote.length === 0) return;
      yield lote.map(csvFila).join('\n') + '\n';
      if (lote.length < LOTE_EXPORT) return;
      cursor = lote[lote.length - 1].id;
    }
  }

  async retencion(companyId: string) {
    const c = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { retencionAuditoriaMeses: true },
    });
    return { meses: c.retencionAuditoriaMeses };
  }

  async fijarRetencion(companyId: string, meses: number, actor: string) {
    await this.prisma.company.update({ where: { id: companyId }, data: { retencionAuditoriaMeses: meses } });
    await this.log({
      companyId,
      usuario: actor,
      accion: 'Retención de auditoría actualizada',
      detalle: `${meses} meses`,
    });
    return { meses };
  }

  /**
   * Daily purge of rows past each company's retention. Rows with no company
   * (Interno actions) use the platform default. One replica runs it (lock).
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async aplicarRetencion() {
    const acquired = await this.redis.set(LOCK_KEY, '1', 'PX', LOCK_TTL_MS, 'NX');
    if (!acquired) return;
    try {
      const companies = await this.prisma.company.findMany({ select: { id: true, retencionAuditoriaMeses: true } });
      let borrados = 0;
      for (const c of companies) {
        const r = await this.prisma.auditLogEntry.deleteMany({
          where: { companyId: c.id, createdAt: { lt: fechaCorte(c.retencionAuditoriaMeses) } },
        });
        borrados += r.count;
      }
      const sinEmpresa = await this.prisma.auditLogEntry.deleteMany({
        where: { companyId: null, createdAt: { lt: fechaCorte(RETENCION_DEFAULT_MESES) } },
      });
      borrados += sinEmpresa.count;
      if (borrados > 0) this.logger.log(`Retención de auditoría: ${borrados} registros eliminados.`);
    } catch (err) {
      reportarFallo(this.logger, 'Retención de auditoría', err);
    } finally {
      await this.redis.del(LOCK_KEY).catch(() => undefined);
    }
  }
}
