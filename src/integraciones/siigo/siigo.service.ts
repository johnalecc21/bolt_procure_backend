import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import {
  EstadoEventoErp,
  EstadoFactura,
  EstadoPago,
  EventoErp,
  IntegracionErp,
  ModoIntegracion,
  TipoEventoErp,
} from '@prisma/client';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { CuentasPorPagarService } from '../../pagos/cuentas-por-pagar.service';
import { ErpEventosService } from '../erp-eventos.service';
import { claveCifrado, descifrar } from '../erp.seguridad';
import { ErrorSiigo, ListaSiigo, SiigoCliente } from './siigo.cliente';
import {
  ConfigSiigo,
  CuotaSiigo,
  ErrorDatos,
  configSiigo,
  cuerpoCompra,
  cuerpoEgreso,
  cuerpoTercero,
  faltantesSiigo,
  marcador,
  separarNit,
} from './siigo.reglas';

export interface ResultadoSiigo {
  ok: boolean;
  idExterno?: string | null;
  referenciaExterna?: string | null;
  error?: string;
}

interface DocSiigo {
  id: string;
  name?: string;
  number?: number;
  balance?: number;
  observations?: string;
}

interface Catalogo {
  id: number;
  code?: string;
  name: string;
  active?: boolean;
  type?: string;
  percentage?: number;
  due_date?: boolean;
}

type Evento = Pick<
  EventoErp,
  | 'id'
  | 'tipo'
  | 'entidadId'
  | 'payload'
  | 'idExterno'
  | 'createdAt'
  | 'companyId'
>;

const LOCK_PAGOS = 'erp:siigo:pagos:lock';

/**
 * Native Siigo Nube connector. Suppliers become "terceros" (type Supplier),
 * approved invoices become purchase invoices (FC) left owed, and payments
 * become disbursements (RP) against that debt — or, when payments are made
 * in Siigo, Procurex reads the invoice balance and marks them paid.
 */
@Injectable()
export class SiigoService {
  private readonly logger = new Logger(SiigoService.name);
  private readonly clave: Buffer;
  private readonly baseUrl: string;
  private readonly partnerId: string;
  private centros = new Map<string, { vence: number; lista: Catalogo[] }>();

  constructor(
    private prisma: PrismaService,
    private eventos: ErpEventosService,
    private cxp: CuentasPorPagarService,
    config: ConfigService,
    @Inject(REDIS_CLIENT) private redis: Redis,
  ) {
    this.clave = claveCifrado(
      config.get<string>('INTEGRACIONES_SECRET') ||
        config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
    );
    this.baseUrl = (
      config.get<string>('SIIGO_API_URL') || 'https://api.siigo.com'
    ).replace(/\/+$/, '');
    this.partnerId = config.get<string>('SIIGO_PARTNER_ID') || 'Procurex';
  }

  cliente(integ: IntegracionErp) {
    const c = configSiigo(integ.conectorConfig);
    if (!c.usuario || !integ.conectorCredencial)
      throw new ErrorDatos('Configura el usuario y la access key de Siigo.');
    return new SiigoCliente(this.baseUrl, this.partnerId, integ.companyId, {
      usuario: c.usuario,
      accessKey: descifrar(integ.conectorCredencial, this.clave),
    });
  }

  // ------------------------------------------------------------ catálogos

  /** Everything the settings screen needs to pick from, straight from Siigo. */
  async catalogos(integ: IntegracionErp) {
    const api = this.cliente(integ);
    const [fc, rp, pagoFc, pagoRp, centros, impuestos] = await Promise.all([
      api.get<Catalogo[]>('/v1/document-types', { type: 'FC' }),
      api.get<Catalogo[]>('/v1/document-types', { type: 'RP' }),
      api.get<Catalogo[]>('/v1/payment-types', { document_type: 'FC' }),
      api.get<Catalogo[]>('/v1/payment-types', { document_type: 'RP' }),
      api.get<Catalogo[]>('/v1/cost-centers'),
      api.get<Catalogo[]>('/v1/taxes'),
    ]);
    const activos = (l: Catalogo[]) =>
      (Array.isArray(l) ? l : []).filter((x) => x.active !== false);
    const simple = (l: Catalogo[]) =>
      activos(l).map((x) => ({
        id: x.id,
        codigo: x.code ?? null,
        nombre: x.name,
      }));
    return {
      documentosCompra: simple(fc),
      documentosEgreso: simple(rp),
      formasPagoCompra: activos(pagoFc).map((p) => ({
        id: p.id,
        nombre: p.name,
        tipo: p.type ?? null,
        conVencimiento: !!p.due_date,
      })),
      formasPagoEgreso: activos(pagoRp).map((p) => ({
        id: p.id,
        nombre: p.name,
        tipo: p.type ?? null,
      })),
      centrosCosto: simple(centros),
      impuestos: activos(impuestos)
        .filter((t) => !t.type || t.type === 'IVA')
        .map((t) => ({
          id: t.id,
          nombre: t.name,
          porcentaje: t.percentage ?? null,
        })),
    };
  }

  async probar(integ: IntegracionErp) {
    try {
      const api = this.cliente(integ);
      const fc = await api.get<Catalogo[]>('/v1/document-types', {
        type: 'FC',
      });
      const faltan = faltantesSiigo(
        configSiigo(integ.conectorConfig),
        !!integ.conectorCredencial,
      );
      return {
        ok: true,
        mensaje:
          `Conectado a Siigo (${Array.isArray(fc) ? fc.length : 0} tipo(s) de factura de compra).` +
          (faltan.length ? ` Falta configurar: ${faltan.join(', ')}.` : ''),
      };
    } catch (err) {
      return { ok: false, mensaje: mensaje(err) };
    }
  }

  // ---------------------------------------------------------------- envío

  async enviar(integ: IntegracionErp, e: Evento): Promise<ResultadoSiigo> {
    try {
      const c = configSiigo(integ.conectorConfig);
      const faltan = faltantesSiigo(c, !!integ.conectorCredencial);
      if (faltan.length)
        return {
          ok: false,
          error: `Falta configurar en Siigo: ${faltan.join(', ')}.`,
        };
      const api = this.cliente(integ);
      switch (e.tipo) {
        case TipoEventoErp.PROVEEDOR:
          return await this.enviarTercero(api, e.entidadId, c);
        case TipoEventoErp.FACTURA:
          return await this.enviarFactura(api, integ, e, c);
        case TipoEventoErp.PAGO:
          return await this.enviarPago(api, e, c);
        default:
          return {
            ok: true,
            referenciaExterna:
              'No aplica: Siigo no recibe órdenes de compra ni recepciones por API',
          };
      }
    } catch (err) {
      return { ok: false, error: mensaje(err) };
    }
  }

  /** Finds the supplier by NIT and creates it only if it isn't there. */
  private async enviarTercero(
    api: SiigoCliente,
    proveedorId: string,
    c: ConfigSiigo,
  ): Promise<ResultadoSiigo> {
    const snap = await this.eventos.proveedor(proveedorId);
    if (!snap) throw new ErrorDatos('El proveedor ya no existe.');
    const { id, creado } = await this.asegurarTercero(api, snap.datos, c);
    return {
      ok: true,
      idExterno: id,
      referenciaExterna: creado ? 'Tercero creado' : 'Tercero existente',
    };
  }

  private async asegurarTercero(
    api: SiigoCliente,
    p: {
      nit: string | null;
      razonSocial: string;
      email: string | null;
      telefono: string | null;
      ubicacion: string | null;
    },
    c: ConfigSiigo,
  ) {
    const nit = separarNit(p.nit);
    if (!nit)
      throw new ErrorDatos(
        `El proveedor ${p.razonSocial} no tiene un NIT válido en su perfil.`,
      );
    const existentes = await api.get<ListaSiigo<{ id: string }>>(
      '/v1/customers',
      { identification: nit.base },
    );
    const existente = existentes.results?.[0];
    if (existente) return { id: existente.id, creado: false };
    const creado = await api.post<{ id: string }>(
      '/v1/customers',
      cuerpoTercero(p, c),
    );
    return { id: creado.id, creado: true };
  }

  private async centroCostoId(
    api: SiigoCliente,
    companyId: string,
    valor: string | null,
  ) {
    if (!valor) return null;
    let cache = this.centros.get(companyId);
    if (!cache || cache.vence < Date.now()) {
      const lista = await api.get<Catalogo[]>('/v1/cost-centers');
      cache = {
        vence: Date.now() + 10 * 60_000,
        lista: Array.isArray(lista) ? lista : [],
      };
      this.centros.set(companyId, cache);
    }
    const v = valor.trim();
    const cc = cache.lista.find((x) => x.code === v || String(x.id) === v);
    if (!cc)
      throw new ErrorDatos(
        `El centro de costo "${v}" no existe en Siigo: revisa el mapeo.`,
      );
    return cc.id;
  }

  /**
   * After a timeout the document may exist anyway, and a manual retry resets
   * the attempt count: always look for our marker in what was created since
   * the event was first queued before creating it (one cheap GET).
   */
  private async buscarPropio(
    api: SiigoCliente,
    ruta: '/v1/purchases' | '/v1/payment-receipts',
    desde: Date,
    marca: string,
  ) {
    for (let page = 1; page <= 5; page++) {
      const r = await api.get<ListaSiigo<DocSiigo>>(ruta, {
        created_start: desde.toISOString().slice(0, 10),
        page,
        page_size: 100,
      });
      const hit = r.results?.find((d) => d.observations?.includes(marca));
      if (hit) return hit;
      if (!r.results || r.results.length < 100) break;
    }
    return null;
  }

  private async enviarFactura(
    api: SiigoCliente,
    integ: IntegracionErp,
    e: Evento,
    c: ConfigSiigo,
  ): Promise<ResultadoSiigo> {
    // An invoice is created once; a re-queued version doesn't duplicate it.
    if (e.idExterno) return { ok: true, idExterno: e.idExterno };
    const f = e.payload as unknown as Parameters<typeof cuerpoCompra>[0] & {
      centroCostoErp: string | null;
      proveedor: { id: string };
    };
    const marca = marcador('factura', f.id);
    const previo = await this.buscarPropio(
      api,
      '/v1/purchases',
      e.createdAt,
      marca,
    );
    if (previo)
      return {
        ok: true,
        idExterno: previo.id,
        referenciaExterna: previo.name ?? null,
      };
    const prov = await this.eventos.proveedor(f.proveedor.id);
    if (!prov) throw new ErrorDatos('El proveedor ya no existe.');
    await this.asegurarTercero(api, prov.datos, c);
    const cc = await this.centroCostoId(api, integ.companyId, f.centroCostoErp);
    const creado = await api.post<DocSiigo>(
      '/v1/purchases',
      cuerpoCompra(f, c, cc),
    );
    return {
      ok: true,
      idExterno: creado.id,
      referenciaExterna: creado.name ?? null,
    };
  }

  private async enviarPago(
    api: SiigoCliente,
    e: Evento,
    c: ConfigSiigo,
  ): Promise<ResultadoSiigo> {
    if (c.pagosDesde === 'SIIGO')
      return {
        ok: true,
        referenciaExterna: 'No aplica: los pagos se registran en Siigo',
      };
    if (e.idExterno) return { ok: true, idExterno: e.idExterno };
    const pago = await this.prisma.pagoPO.findUnique({
      where: { id: e.entidadId },
      include: {
        proveedor: { select: { nit: true, nombre: true } },
        facturas: {
          where: { estado: EstadoFactura.APROBADA },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!pago?.fechaPago) throw new ErrorDatos('El pago no está registrado.');
    const factura = pago.facturas[0];
    if (!factura) throw new ErrorDatos('El pago no tiene factura aprobada.');
    const evFactura = await this.prisma.eventoErp.findUnique({
      where: {
        companyId_tipo_entidadId: {
          companyId: e.companyId,
          tipo: TipoEventoErp.FACTURA,
          entidadId: factura.id,
        },
      },
    });
    if (!evFactura?.idExterno) {
      // Approved before the integration was on: queue it now.
      if (!evFactura)
        await this.eventos.emitir(
          e.companyId,
          TipoEventoErp.FACTURA,
          factura.id,
        );
      return {
        ok: false,
        error: `La factura ${factura.numero} aún no está en Siigo; el egreso se enviará después de ella.`,
      };
    }
    const marca = marcador('pago', pago.id);
    const previo = await this.buscarPropio(
      api,
      '/v1/payment-receipts',
      e.createdAt,
      marca,
    );
    if (previo)
      return {
        ok: true,
        idExterno: previo.id,
        referenciaExterna: previo.name ?? null,
      };
    const compra = await api.get<DocSiigo>(
      `/v1/purchases/${encodeURIComponent(evFactura.idExterno)}`,
    );
    if (compra.balance !== undefined && compra.balance <= 0)
      return {
        ok: true,
        referenciaExterna: `${compra.name ?? 'Factura'} ya estaba saldada en Siigo`,
      };
    const nit = separarNit(pago.proveedor.nit);
    if (!nit)
      throw new ErrorDatos(
        `El proveedor ${pago.proveedor.nombre} no tiene un NIT válido.`,
      );
    const cuota = await this.cuotaPendiente(api, nit.base, compra);
    const creado = await api.post<DocSiigo>(
      '/v1/payment-receipts',
      cuerpoEgreso({
        pagoId: pago.id,
        nit: nit.base,
        fechaPago: pago.fechaPago.toISOString().slice(0, 10),
        cuota,
        valorPagado: pago.montoPagado ?? pago.monto,
        referencia: pago.referenciaPago,
        factura: factura.numero,
        c,
      }),
    );
    return {
      ok: true,
      idExterno: creado.id,
      referenciaExterna: creado.name ?? null,
    };
  }

  /** The open installment of that purchase in Siigo's accounts payable. */
  private async cuotaPendiente(
    api: SiigoCliente,
    nit: string,
    compra: DocSiigo,
  ): Promise<CuotaSiigo> {
    for (let page = 1; page <= 10; page++) {
      const r = await api.get<
        ListaSiigo<CuentaPorPagar> | { value: ListaSiigo<CuentaPorPagar> }
      >('/v1/accounts-payable', {
        provider_identification: nit,
        page,
        page_size: 100,
      });
      const lista = 'value' in r ? r.value : r;
      const candidatas = (lista.results ?? []).filter(
        (x) =>
          Number(x.due.consecutive) === compra.number &&
          Number(x.due.balance) > 0,
      );
      const hit =
        candidatas.find(
          (x) => !!compra.name && compra.name.startsWith(x.due.prefix),
        ) ?? (candidatas.length === 1 ? candidatas[0] : undefined);
      if (hit)
        return {
          prefix: hit.due.prefix,
          consecutive: Number(hit.due.consecutive),
          quote: Number(hit.due.quote) || 1,
          date: String(hit.due.date).slice(0, 10),
          balance: Number(hit.due.balance),
        };
      if (!lista.results || lista.results.length < 100) break;
    }
    throw new ErrorDatos(
      `No se encontró la cuenta por pagar de ${compra.name ?? 'la factura'} en Siigo.`,
    );
  }

  // --------------------------------------------- pagos hechos en Siigo

  @Interval(10 * 60_000)
  async sincronizarPagosProgramado() {
    const ok = await this.redis.set(LOCK_PAGOS, '1', 'PX', 9 * 60_000, 'NX');
    if (!ok) return;
    try {
      const integraciones = await this.prisma.integracionErp.findMany({
        where: { activa: true, modo: ModoIntegracion.SIIGO },
      });
      for (const i of integraciones)
        if (configSiigo(i.conectorConfig).pagosDesde === 'SIIGO')
          await this.sincronizarPagos(i).catch((err) =>
            this.logger.warn(
              `Sincronización de pagos Siigo ${i.companyId}: ${mensaje(err)}`,
            ),
          );
    } finally {
      await this.redis.del(LOCK_PAGOS).catch(() => undefined);
    }
  }

  /**
   * Invoices sent to Siigo whose payment is still open in Procurex: when the
   * purchase has no balance left in Siigo, the payment is marked paid.
   */
  async sincronizarPagos(integ: IntegracionErp) {
    const api = this.cliente(integ);
    const eventos = await this.prisma.eventoErp.findMany({
      where: {
        companyId: integ.companyId,
        tipo: TipoEventoErp.FACTURA,
        estado: EstadoEventoErp.ENVIADO,
        idExterno: { not: null },
      },
      select: { entidadId: true, idExterno: true, referenciaExterna: true },
      orderBy: { enviadoAt: 'asc' },
    });
    const facturas = await this.prisma.factura.findMany({
      where: {
        id: { in: eventos.map((e) => e.entidadId) },
        pago: { estado: { not: EstadoPago.PAGADO } },
      },
      select: { id: true, pagoId: true },
    });
    const abiertas = new Map(facturas.map((f) => [f.id, f.pagoId]));
    let revisadas = 0;
    let pagadas = 0;
    const errores: string[] = [];
    for (const e of eventos) {
      const pagoId = abiertas.get(e.entidadId);
      if (!pagoId || revisadas >= 150) continue;
      revisadas++;
      try {
        const compra = await api.get<DocSiigo>(
          `/v1/purchases/${encodeURIComponent(e.idExterno!)}`,
        );
        if (compra.balance === undefined || compra.balance > 0) continue;
        await this.cxp.registrarPago(
          integ.companyId,
          pagoId,
          {
            fechaPago: new Date().toISOString(),
            referencia:
              `Siigo ${compra.name ?? e.referenciaExterna ?? e.idExterno}`.slice(
                0,
                100,
              ),
          },
          'Siigo (integración)',
          true,
        );
        pagadas++;
      } catch (err) {
        errores.push(mensaje(err));
      }
    }
    return { revisadas, pagadas, errores: errores.slice(0, 5) };
  }
}

interface CuentaPorPagar {
  due: {
    prefix: string;
    consecutive: number | string;
    quote: number | string;
    date: string;
    balance: number | string;
  };
}

function mensaje(err: unknown) {
  if (err instanceof ErrorDatos || err instanceof ErrorSiigo)
    return err.message;
  return err instanceof Error ? err.message : String(err);
}
