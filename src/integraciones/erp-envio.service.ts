import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import {
  EstadoEventoErp,
  EventoErp,
  IntegracionErp,
  ModoIntegracion,
} from '@prisma/client';
import type { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { SiigoService } from './siigo/siigo.service';
import {
  claveCifrado,
  descifrar,
  firmar,
  validarUrlWebhook,
} from './erp.seguridad';

const LOCK_KEY = 'erp:envio:lock';
const LOCK_TTL_MS = 2 * 60 * 1000;
const LOTE = 50;
const TIMEOUT_MS = 10_000;
/** Wait before each retry (minutes); after the last one the event is FALLIDO. */
export const ESPERAS_MIN = [1, 5, 30, 120, 720, 1440];

export function proximoIntento(
  intentos: number,
  ahora = Date.now(),
): Date | null {
  const espera = ESPERAS_MIN[intentos - 1];
  return espera == null ? null : new Date(ahora + espera * 60_000);
}

export interface ResultadoEnvio {
  ok: boolean;
  status?: number;
  idExterno?: string | null;
  referenciaExterna?: string | null;
  error?: string;
}

/**
 * Delivers queued documents to each company's webhook: signed with its
 * secret, one POST per document, retried with growing waits. Runs every 30s
 * on whichever instance wins the lock.
 */
@Injectable()
export class ErpEnvioService {
  private readonly logger = new Logger(ErpEnvioService.name);
  private readonly clave: Buffer;
  private readonly permitirLocal: boolean;

  constructor(
    private prisma: PrismaService,
    config: ConfigService,
    @Inject(REDIS_CLIENT) private redis: Redis,
    private siigo: SiigoService,
  ) {
    this.clave = claveCifrado(
      config.get<string>('INTEGRACIONES_SECRET') ||
        config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
    );
    this.permitirLocal = config.get('NODE_ENV') !== 'production';
  }

  get claveSecretos() {
    return this.clave;
  }

  get localPermitido() {
    return this.permitirLocal;
  }

  @Interval(30_000)
  async procesarPendientes() {
    const ok = await this.redis.set(LOCK_KEY, '1', 'PX', LOCK_TTL_MS, 'NX');
    if (!ok) return;
    try {
      await this.procesar();
    } catch (err) {
      this.logger.error(
        'Falló el envío de eventos al ERP',
        err instanceof Error ? err.stack : err,
      );
    } finally {
      await this.redis.del(LOCK_KEY).catch(() => undefined);
    }
  }

  async procesar(companyId?: string) {
    const eventos = await this.prisma.eventoErp.findMany({
      where: {
        estado: { in: [EstadoEventoErp.PENDIENTE, EstadoEventoErp.ERROR] },
        proximoIntento: { lte: new Date() },
        ...(companyId ? { companyId } : {}),
        company: {
          integracionErp: {
            activa: true,
            modo: { in: [ModoIntegracion.WEBHOOK, ModoIntegracion.SIIGO] },
          },
        },
      },
      // Suppliers before the orders that reference them, then oldest first.
      orderBy: [{ createdAt: 'asc' }],
      take: LOTE,
      include: {
        company: { select: { id: true, nombre: true, integracionErp: true } },
      },
    });
    let enviados = 0;
    for (const e of eventos) {
      const integ = e.company.integracionErp!;
      const r =
        integ.modo === ModoIntegracion.SIIGO
          ? await this.siigo.enviar(integ, e)
          : await this.enviar(integ, e, e.company.nombre);
      await this.registrarResultado(e, r);
      if (r.ok) enviados++;
    }
    return { procesados: eventos.length, enviados };
  }

  cuerpo(
    e: Pick<
      EventoErp,
      | 'id'
      | 'tipo'
      | 'version'
      | 'entidadId'
      | 'referencia'
      | 'payload'
      | 'updatedAt'
    >,
    empresa: { id: string; nombre: string },
  ) {
    return JSON.stringify({
      id: e.id,
      tipo: e.tipo,
      version: e.version,
      entidadId: e.entidadId,
      referencia: e.referencia,
      empresa,
      ocurrido: e.updatedAt.toISOString(),
      datos: e.payload,
    });
  }

  async enviar(
    integ: IntegracionErp,
    e: Pick<
      EventoErp,
      | 'id'
      | 'tipo'
      | 'version'
      | 'entidadId'
      | 'referencia'
      | 'payload'
      | 'updatedAt'
      | 'companyId'
    >,
    empresaNombre: string,
  ): Promise<ResultadoEnvio> {
    if (!integ.webhookUrl || !integ.secretoCifrado)
      return {
        ok: false,
        error: 'Falta configurar la URL o el secreto del webhook.',
      };
    // Re-checked on every send: DNS may have changed since it was saved.
    const invalida = await validarUrlWebhook(
      integ.webhookUrl,
      this.permitirLocal,
    );
    if (invalida) return { ok: false, error: invalida };
    const secreto = descifrar(integ.secretoCifrado, this.clave);
    const body = this.cuerpo(e, { id: e.companyId, nombre: empresaNombre });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    try {
      const res = await fetch(integ.webhookUrl, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Procurex-ERP/1.0',
          'X-Procurex-Evento': e.tipo,
          'X-Procurex-Entrega': `${e.id}:${e.version}`,
          'X-Procurex-Timestamp': timestamp,
          'X-Procurex-Firma': firmar(secreto, timestamp, body),
        },
        body,
      });
      const texto = (await res.text().catch(() => '')).slice(0, 2000);
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          error: `El ERP respondió ${res.status}${texto ? `: ${texto.slice(0, 300)}` : ''}`,
        };
      }
      let idExterno: string | null = null;
      try {
        const json = JSON.parse(texto) as { idExterno?: unknown; id?: unknown };
        const v = json.idExterno ?? json.id;
        if (typeof v === 'string' || typeof v === 'number')
          idExterno = String(v).slice(0, 120);
      } catch {
        // A 2xx without JSON is still an accepted delivery.
      }
      return { ok: true, status: res.status, idExterno };
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.name === 'TimeoutError'
            ? 'Tiempo de espera agotado (10 s).'
            : err.message
          : String(err);
      return { ok: false, error: `No se pudo conectar: ${msg}` };
    }
  }

  private async registrarResultado(e: EventoErp, r: ResultadoEnvio) {
    if (r.ok) {
      // Conditional on the version: if the document changed while sending,
      // the newer version stays queued.
      await this.prisma.eventoErp.updateMany({
        where: { id: e.id, version: e.version },
        data: {
          estado: EstadoEventoErp.ENVIADO,
          enviadoAt: new Date(),
          ultimoError: null,
          ...(r.idExterno ? { idExterno: r.idExterno } : {}),
          ...(r.referenciaExterna
            ? { referenciaExterna: r.referenciaExterna.slice(0, 200) }
            : {}),
        },
      });
      return;
    }
    const intentos = e.intentos + 1;
    const siguiente = proximoIntento(intentos);
    await this.prisma.eventoErp.updateMany({
      where: { id: e.id, version: e.version },
      data: {
        intentos,
        ultimoError: r.error?.slice(0, 1000) ?? 'Error desconocido',
        estado: siguiente ? EstadoEventoErp.ERROR : EstadoEventoErp.FALLIDO,
        ...(siguiente ? { proximoIntento: siguiente } : {}),
      },
    });
  }
}
