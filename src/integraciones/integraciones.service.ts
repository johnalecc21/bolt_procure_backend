import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  EstadoEventoErp,
  EstadoFactura,
  EstadoPago,
  ModoIntegracion,
  Prisma,
  TipoEventoErp,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CuentasPorPagarService } from '../pagos/cuentas-por-pagar.service';
import { ErpEventosService } from './erp-eventos.service';
import { ErpEnvioService } from './erp-envio.service';
import { agregar, hojasVacias, type HojasErp } from './erp.filas';
import {
  cifrar,
  hashApiKey,
  nuevoSecreto,
  validarUrlWebhook,
} from './erp.seguridad';
import {
  AcuseDto,
  ActualizarIntegracionDto,
  GuardarMapeosDto,
  ListarEventosDto,
  PagoEntranteDto,
} from './dto/integraciones.dto';

const POR_PAGINA = 50;
const MAX_EXPORT = 2000;

@Injectable()
export class IntegracionesService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private eventos: ErpEventosService,
    private envio: ErpEnvioService,
    private cxp: CuentasPorPagarService,
  ) {}

  // ---------------------------------------------------------- configuración

  private async integracion(companyId: string) {
    return this.prisma.integracionErp.upsert({
      where: { companyId },
      create: { companyId },
      update: {},
    });
  }

  /** Config as the screen sees it — never the secret or the key. */
  async obtener(companyId: string) {
    const i = await this.integracion(companyId);
    const conteo = await this.prisma.eventoErp.groupBy({
      by: ['estado'],
      where: { companyId },
      _count: true,
    });
    return {
      activa: i.activa,
      modo: i.modo,
      sistema: i.sistema,
      webhookUrl: i.webhookUrl,
      tieneSecreto: !!i.secretoCifrado,
      apiKeyPrefijo: i.apiKeyPrefijo,
      eventos: i.eventos,
      ultimaPrueba: i.ultimaPrueba,
      ultimaPruebaOk: i.ultimaPruebaOk,
      ultimaPruebaMsg: i.ultimaPruebaMsg,
      conteo: Object.fromEntries(conteo.map((c) => [c.estado, c._count])),
    };
  }

  async actualizar(
    companyId: string,
    dto: ActualizarIntegracionDto,
    actor: string,
  ) {
    const actual = await this.integracion(companyId);
    const data: Prisma.IntegracionErpUpdateInput = {};
    if (dto.sistema !== undefined) data.sistema = dto.sistema.trim() || null;
    if (dto.modo !== undefined) data.modo = dto.modo;
    if (dto.eventos !== undefined) data.eventos = dto.eventos;
    if (dto.webhookUrl !== undefined) {
      const url = dto.webhookUrl.trim();
      if (url) {
        const error = await validarUrlWebhook(url, this.envio.localPermitido);
        if (error) throw new BadRequestException(error);
      }
      data.webhookUrl = url || null;
    }
    const modo = dto.modo ?? actual.modo;
    const url =
      dto.webhookUrl !== undefined ? dto.webhookUrl.trim() : actual.webhookUrl;
    if (dto.activa) {
      if (modo === ModoIntegracion.WEBHOOK && (!url || !actual.secretoCifrado))
        throw new BadRequestException(
          'Para activar el envío por webhook configura la URL y genera el secreto de firma.',
        );
    }
    if (dto.activa !== undefined) data.activa = dto.activa;
    await this.prisma.integracionErp.update({ where: { companyId }, data });
    await this.auditLog.log({
      companyId,
      usuario: actor,
      accion: 'Integración ERP actualizada',
      detalle:
        [
          dto.activa !== undefined
            ? dto.activa
              ? 'activada'
              : 'desactivada'
            : null,
          dto.modo ? `modo ${dto.modo}` : null,
          dto.webhookUrl !== undefined ? 'URL del webhook cambiada' : null,
          dto.eventos ? `eventos: ${dto.eventos.join(', ') || 'todos'}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || 'sin cambios',
    });
    return this.obtener(companyId);
  }

  /** New signing secret: shown once, stored encrypted. */
  async generarSecreto(companyId: string, actor: string) {
    await this.integracion(companyId);
    const secreto = nuevoSecreto('whsec');
    await this.prisma.integracionErp.update({
      where: { companyId },
      data: { secretoCifrado: cifrar(secreto, this.envio.claveSecretos) },
    });
    await this.auditLog.log({
      companyId,
      usuario: actor,
      accion: 'Secreto del webhook ERP regenerado',
      detalle: 'El anterior deja de ser válido',
    });
    return { secreto };
  }

  /** New API key for the ERP to report payments: shown once, stored hashed. */
  async generarApiKey(companyId: string, actor: string) {
    await this.integracion(companyId);
    const apiKey = nuevoSecreto('pcx');
    const prefijo = apiKey.slice(0, 10);
    await this.prisma.integracionErp.update({
      where: { companyId },
      data: { apiKeyHash: hashApiKey(apiKey), apiKeyPrefijo: prefijo },
    });
    await this.auditLog.log({
      companyId,
      usuario: actor,
      accion: 'API key del ERP regenerada',
      detalle: `${prefijo}… (la anterior deja de funcionar)`,
    });
    return { apiKey };
  }

  /** Sends a signed "PRUEBA" event right away and reports the answer. */
  async probar(companyId: string) {
    const i = await this.integracion(companyId);
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { nombre: true },
    });
    const r = await this.envio.enviar(
      i,
      {
        id: `prueba_${Date.now()}`,
        tipo: 'PRUEBA' as TipoEventoErp,
        version: 1,
        entidadId: companyId,
        referencia: 'Prueba de conexión',
        payload: {
          mensaje: 'Si recibes esto, la conexión y la firma funcionan.',
        },
        updatedAt: new Date(),
        companyId,
      },
      company.nombre,
    );
    const msg = r.ok
      ? `Respondió ${r.status}${r.idExterno ? ` (id ${r.idExterno})` : ''}.`
      : (r.error ?? 'Falló');
    await this.prisma.integracionErp.update({
      where: { companyId },
      data: {
        ultimaPrueba: new Date(),
        ultimaPruebaOk: r.ok,
        ultimaPruebaMsg: msg,
      },
    });
    return { ok: r.ok, mensaje: msg };
  }

  // --------------------------------------------------------------- eventos

  async listarEventos(companyId: string, dto: ListarEventosDto) {
    const where: Prisma.EventoErpWhereInput = {
      companyId,
      ...(dto.estado ? { estado: dto.estado } : {}),
      ...(dto.tipo ? { tipo: dto.tipo } : {}),
    };
    const page = dto.page ?? 1;
    const [items, total] = await Promise.all([
      this.prisma.eventoErp.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * POR_PAGINA,
        take: POR_PAGINA,
        select: {
          id: true,
          tipo: true,
          entidadId: true,
          referencia: true,
          version: true,
          estado: true,
          intentos: true,
          proximoIntento: true,
          ultimoError: true,
          idExterno: true,
          enviadoAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.eventoErp.count({ where }),
    ]);
    return {
      items,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / POR_PAGINA)),
    };
  }

  async verEvento(companyId: string, id: string) {
    const e = await this.prisma.eventoErp.findFirst({
      where: { id, companyId },
    });
    if (!e) throw new NotFoundException('Evento no encontrado.');
    return e;
  }

  /** Back to the queue now (after fixing a mapping, the URL…); rebuilt from current data. */
  async reintentar(companyId: string, id: string) {
    const e = await this.verEvento(companyId, id);
    await this.eventos.emitir(companyId, e.tipo, e.entidadId);
    const i = await this.integracion(companyId);
    if (i.modo === ModoIntegracion.WEBHOOK)
      await this.envio.procesar(companyId);
    return this.verEvento(companyId, id);
  }

  async descartar(companyId: string, id: string, actor: string) {
    const e = await this.verEvento(companyId, id);
    await this.prisma.eventoErp.update({
      where: { id },
      data: { estado: EstadoEventoErp.DESCARTADO },
    });
    await this.auditLog.log({
      companyId,
      usuario: actor,
      accion: 'Evento ERP descartado',
      detalle: `${e.tipo} ${e.referencia}`,
    });
    return { ok: true };
  }

  /**
   * File mode: everything queued, as import sheets. Marking them exported is
   * a separate step, done once the file was downloaded.
   */
  async pendientes(companyId: string) {
    const eventos = await this.prisma.eventoErp.findMany({
      where: {
        companyId,
        estado: {
          in: [
            EstadoEventoErp.PENDIENTE,
            EstadoEventoErp.ERROR,
            EstadoEventoErp.FALLIDO,
          ],
        },
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_EXPORT,
    });
    const hojas = hojasVacias();
    for (const e of eventos) agregar(hojas, e.tipo, e.payload);
    return {
      ids: eventos.map((e) => e.id),
      hojas,
      truncado: eventos.length === MAX_EXPORT,
    };
  }

  async marcarExportados(companyId: string, ids: string[], actor: string) {
    const { count } = await this.prisma.eventoErp.updateMany({
      where: {
        companyId,
        id: { in: ids },
        estado: { not: EstadoEventoErp.DESCARTADO },
      },
      data: {
        estado: EstadoEventoErp.ENVIADO,
        enviadoAt: new Date(),
        ultimoError: null,
      },
    });
    await this.auditLog.log({
      companyId,
      usuario: actor,
      accion: 'Documentos exportados al ERP',
      detalle: `${count} documento(s) marcados como exportados`,
    });
    return { marcados: count };
  }

  // ---------------------------------------------------------------- mapeos

  async listarMapeos(companyId: string) {
    const [mapeos, centros, categorias] = await Promise.all([
      this.prisma.mapeoErp.findMany({ where: { companyId } }),
      this.prisma.centroCosto.findMany({
        where: { companyId },
        select: { codigo: true, nombre: true, activo: true },
        orderBy: { codigo: 'asc' },
      }),
      this.prisma.contrato.findMany({
        where: { companyId },
        distinct: ['categoria'],
        select: { categoria: true },
      }),
    ]);
    const req = await this.prisma.requerimiento.findMany({
      where: { companyId },
      distinct: ['categoria'],
      select: { categoria: true },
    });
    const cats = [
      ...new Set([...categorias, ...req].map((c) => c.categoria)),
    ].sort();
    const valor = (tipo: string, local: string) =>
      mapeos.find((m) => m.tipo === tipo && m.valorLocal === local)?.valorErp ??
      '';
    return {
      centros: centros.map((c) => ({
        valorLocal: c.codigo,
        nombre: c.nombre,
        activo: c.activo,
        valorErp: valor('CENTRO_COSTO', c.codigo),
      })),
      categorias: cats.map((c) => ({
        valorLocal: c,
        nombre: c,
        activo: true,
        valorErp: valor('CATEGORIA', c),
      })),
    };
  }

  async guardarMapeos(companyId: string, dto: GuardarMapeosDto, actor: string) {
    await this.prisma.$transaction(
      dto.mapeos.map((m) =>
        m.valorErp.trim()
          ? this.prisma.mapeoErp.upsert({
              where: {
                companyId_tipo_valorLocal: {
                  companyId,
                  tipo: m.tipo,
                  valorLocal: m.valorLocal,
                },
              },
              create: {
                companyId,
                tipo: m.tipo,
                valorLocal: m.valorLocal,
                valorErp: m.valorErp.trim(),
              },
              update: { valorErp: m.valorErp.trim() },
            })
          : this.prisma.mapeoErp.deleteMany({
              where: { companyId, tipo: m.tipo, valorLocal: m.valorLocal },
            }),
      ),
    );
    await this.auditLog.log({
      companyId,
      usuario: actor,
      accion: 'Mapeos ERP actualizados',
      detalle: `${dto.mapeos.length} valor(es)`,
    });
    return this.listarMapeos(companyId);
  }

  // ------------------------------------------------------------ exportación

  /**
   * Any period, whether or not the integration is on: every order signed,
   * receipt recorded, invoice approved and payment made in the range, plus
   * their suppliers. Same columns as the pending-events file.
   */
  async exportar(
    companyId: string,
    desde: string,
    hasta: string,
  ): Promise<HojasErp & { truncado: boolean }> {
    const rango = {
      gte: new Date(`${desde}T00:00:00`),
      lt: new Date(new Date(`${hasta}T00:00:00`).getTime() + 86_400_000),
    };
    if (!(rango.gte < rango.lt))
      throw new BadRequestException('Rango de fechas inválido.');
    const [contratos, hitos, facturas, pagos] = await Promise.all([
      this.prisma.contrato.findMany({
        where: { companyId, createdAt: rango },
        select: { id: true, proveedorId: true },
        orderBy: { createdAt: 'asc' },
        take: MAX_EXPORT,
      }),
      this.prisma.hitoSeguimiento.findMany({
        where: { contrato: { companyId }, estado: 'COMPLETADO', real: rango },
        select: { id: true },
        take: MAX_EXPORT,
      }),
      this.prisma.factura.findMany({
        where: {
          pago: { contrato: { companyId } },
          estado: EstadoFactura.APROBADA,
          revisadaAt: rango,
        },
        select: { id: true, pago: { select: { proveedorId: true } } },
        take: MAX_EXPORT,
      }),
      this.prisma.pagoPO.findMany({
        where: {
          contrato: { companyId },
          estado: EstadoPago.PAGADO,
          fechaPago: rango,
        },
        select: { id: true, proveedorId: true },
        take: MAX_EXPORT,
      }),
    ]);
    const mapeos = await this.eventos.mapeos(companyId);
    const hojas = hojasVacias();
    const proveedores = new Set<string>([
      ...contratos.map((c) => c.proveedorId).filter((x): x is string => !!x),
      ...facturas.map((f) => f.pago.proveedorId),
      ...pagos.map((p) => p.proveedorId),
    ]);
    const tareas: [TipoEventoErp, string][] = [
      ...[...proveedores].map(
        (id) => [TipoEventoErp.PROVEEDOR, id] as [TipoEventoErp, string],
      ),
      ...contratos.map(
        (c) => [TipoEventoErp.ORDEN_COMPRA, c.id] as [TipoEventoErp, string],
      ),
      ...hitos.map(
        (h) => [TipoEventoErp.RECEPCION, h.id] as [TipoEventoErp, string],
      ),
      ...facturas.map(
        (f) => [TipoEventoErp.FACTURA, f.id] as [TipoEventoErp, string],
      ),
      ...pagos.map(
        (p) => [TipoEventoErp.PAGO, p.id] as [TipoEventoErp, string],
      ),
    ];
    for (const [tipo, id] of tareas) {
      const snap = await this.eventos.snapshot(tipo, id, mapeos);
      if (snap) agregar(hojas, tipo, snap.datos);
    }
    const truncado = [contratos, hitos, facturas, pagos].some(
      (l) => l.length === MAX_EXPORT,
    );
    return { ...hojas, truncado };
  }

  // ------------------------------------------------- lo que llega del ERP

  async empresaPorApiKey(apiKey: string | undefined) {
    if (!apiKey) throw new UnauthorizedException('Falta la API key.');
    const i = await this.prisma.integracionErp.findFirst({
      where: { apiKeyHash: hashApiKey(apiKey) },
    });
    if (!i) throw new UnauthorizedException('API key inválida.');
    return i.companyId;
  }

  /**
   * The ERP reports a payment it made: the payment is registered as if
   * finance had done it (same rules: approved invoice, not twice). Idempotent:
   * reporting an already-paid payment answers ok without changing anything.
   */
  async pagoEntrante(companyId: string, dto: PagoEntranteDto) {
    let pagoId = dto.pagoId;
    if (!pagoId) {
      if (!dto.numeroFactura)
        throw new BadRequestException('Envía pagoId o numeroFactura.');
      const facturas = await this.prisma.factura.findMany({
        where: {
          numero: dto.numeroFactura,
          estado: EstadoFactura.APROBADA,
          pago: {
            contrato: { companyId },
            ...(dto.nitProveedor
              ? { proveedor: { nit: dto.nitProveedor } }
              : {}),
          },
        },
        select: { pagoId: true },
      });
      if (facturas.length === 0)
        throw new NotFoundException(
          'No hay una factura aprobada con ese número.',
        );
      if (facturas.length > 1)
        throw new ConflictException(
          'Hay varias facturas con ese número: envía también nitProveedor o el pagoId.',
        );
      pagoId = facturas[0].pagoId;
    }
    const pago = await this.prisma.pagoPO.findFirst({
      where: { id: pagoId, contrato: { companyId } },
    });
    if (!pago) throw new NotFoundException('Pago no encontrado.');
    if (pago.estado === EstadoPago.PAGADO)
      return { ok: true, pagoId, yaRegistrado: true };
    await this.cxp.registrarPago(
      companyId,
      pagoId,
      { fechaPago: dto.fechaPago, referencia: dto.referencia },
      'ERP (integración)',
      true,
    );
    return { ok: true, pagoId, yaRegistrado: false };
  }

  async acuse(companyId: string, dto: AcuseDto) {
    const { count } = await this.prisma.eventoErp.updateMany({
      where: { id: dto.eventoId, companyId },
      data: {
        idExterno: dto.idExterno,
        estado: EstadoEventoErp.ENVIADO,
        enviadoAt: new Date(),
        ultimoError: null,
      },
    });
    if (count === 0) throw new NotFoundException('Evento no encontrado.');
    return { ok: true };
  }

  /** Sync state of one document (contract page, payables). */
  async estadoDocumentos(companyId: string, entidadIds: string[]) {
    if (entidadIds.length === 0) return [];
    return this.prisma.eventoErp.findMany({
      where: { companyId, entidadId: { in: entidadIds } },
      select: {
        entidadId: true,
        tipo: true,
        estado: true,
        idExterno: true,
        ultimoError: true,
        enviadoAt: true,
      },
    });
  }
}
