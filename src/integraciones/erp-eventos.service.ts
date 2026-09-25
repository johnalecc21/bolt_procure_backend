import { Injectable, Logger } from '@nestjs/common';
import {
  EstadoContrato,
  EstadoEventoErp,
  ModoIntegracion,
  Prisma,
  TipoEventoErp,
  TipoMapeoErp,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  formatContratoCodigo,
  formatRequerimientoCodigo,
} from '../common/utils/codigo.util';
import { TIPOS_SIIGO, configSiigo } from './siigo/siigo.reglas';

const fecha = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : null;

type Mapeos = { centro: Map<string, string>; categoria: Map<string, string> };

/**
 * What goes to the ERP. Each business document becomes a full, flat
 * snapshot (never a diff): the downloadable file and the webhook carry the
 * exact same data, and the receiver can simply upsert by (tipo, id).
 */
@Injectable()
export class ErpEventosService {
  private readonly logger = new Logger(ErpEventosService.name);

  constructor(private prisma: PrismaService) {}

  async mapeos(companyId: string): Promise<Mapeos> {
    const filas = await this.prisma.mapeoErp.findMany({ where: { companyId } });
    const de = (t: TipoMapeoErp) =>
      new Map(
        filas
          .filter((f) => f.tipo === t)
          .map((f) => [f.valorLocal, f.valorErp]),
      );
    return {
      centro: de(TipoMapeoErp.CENTRO_COSTO),
      categoria: de(TipoMapeoErp.CATEGORIA),
    };
  }

  // -------------------------------------------------------------- snapshots

  async proveedor(proveedorId: string) {
    const p = await this.prisma.proveedorProfile.findUnique({
      where: { id: proveedorId },
      include: { user: { select: { email: true } } },
    });
    if (!p) return null;
    return {
      referencia: p.nit ? `NIT ${p.nit}` : p.nombre,
      datos: {
        id: p.id,
        nit: p.nit,
        razonSocial: p.nombre,
        email: p.emailContacto ?? p.user?.email ?? null,
        telefono: p.telefonoContacto,
        ubicacion: p.ubicacion,
        categorias: p.categorias,
      },
    };
  }

  async ordenCompra(contratoId: string, mapeos: Mapeos) {
    const c = await this.prisma.contrato.findUnique({
      where: { id: contratoId },
      include: {
        proveedor: { select: { id: true, nit: true, nombre: true } },
        centroCosto: { select: { codigo: true, nombre: true } },
        requerimiento: { select: { numero: true, titulo: true } },
        padre: { select: { id: true, tipo: true, numero: true } },
        adjudicacion: { include: { lineas: { include: { item: true } } } },
        hitos: { orderBy: { orden: 'asc' } },
      },
    });
    if (!c) return null;
    const codigo = formatContratoCodigo(c.tipo, c.numero);
    const lineas = c.adjudicacion?.lineas.length
      ? [...c.adjudicacion.lineas]
          .sort((a, b) => a.item.orden - b.item.orden)
          .map((l, i) => ({
            linea: i + 1,
            descripcion: l.item.descripcion,
            cantidad: l.cantidad,
            unidad: l.item.unidad,
            precioUnitario: l.precioUnitario,
            subtotal: l.subtotal,
          }))
      : // A lump-sum award becomes one line for the whole value.
        [
          {
            linea: 1,
            descripcion: c.requerimiento?.titulo ?? c.categoria,
            cantidad: 1,
            unidad: 'global',
            precioUnitario: c.monto,
            subtotal: c.monto,
          },
        ];
    return {
      referencia: codigo,
      datos: {
        id: c.id,
        codigo,
        tipo:
          c.tipo === 'CONTRATO' && !c.contratoPadreId
            ? 'CONTRATO_MARCO'
            : c.tipo,
        estado: c.estado,
        anulada: c.estado === EstadoContrato.TERMINADO,
        motivoAnulacion: c.motivoTerminacion,
        numeroOrdenCompra: c.adjudicacion?.poId ?? codigo,
        contratoMarco: c.padre
          ? {
              id: c.padre.id,
              codigo: formatContratoCodigo(c.padre.tipo, c.padre.numero),
            }
          : null,
        requerimiento: c.requerimiento
          ? {
              codigo: formatRequerimientoCodigo(c.requerimiento.numero),
              titulo: c.requerimiento.titulo,
            }
          : null,
        proveedor: {
          id: c.proveedorId,
          nit: c.proveedor?.nit ?? null,
          razonSocial: c.proveedor?.nombre ?? c.proveedorNombre,
        },
        fechaFirma: fecha(c.createdAt),
        vigenciaInicio: fecha(c.vigenciaInicio),
        vigenciaFin: fecha(c.vigenciaFin),
        moneda: c.moneda,
        valorTotal: c.monto,
        condicionesPagoDias: c.condicionesPagoDias,
        centroCosto: c.centroCosto
          ? {
              codigo: c.centroCosto.codigo,
              nombre: c.centroCosto.nombre,
              codigoErp: mapeos.centro.get(c.centroCosto.codigo) ?? null,
            }
          : null,
        categoria: {
          nombre: c.categoria,
          cuentaErp: mapeos.categoria.get(c.categoria) ?? null,
        },
        lineas,
        hitos: c.hitos.map((h) => ({
          id: h.id,
          descripcion: h.label,
          fechaComprometida: fecha(h.comprometido),
          porcentaje: h.porcentaje,
          valor: Math.round((c.monto * h.porcentaje) / 100),
        })),
      },
    };
  }

  async recepcion(hitoId: string) {
    const h = await this.prisma.hitoSeguimiento.findUnique({
      where: { id: hitoId },
      include: {
        contrato: {
          include: { proveedor: { select: { nit: true, nombre: true } } },
        },
        pagoGenerado: { select: { id: true, monto: true } },
      },
    });
    if (!h || !h.real) return null;
    const orden = formatContratoCodigo(h.contrato.tipo, h.contrato.numero);
    return {
      referencia: `${orden} · ${h.label}`,
      datos: {
        id: h.id,
        orden: { id: h.contratoId, codigo: orden },
        proveedor: {
          nit: h.contrato.proveedor?.nit ?? null,
          razonSocial: h.contrato.proveedorNombre,
        },
        descripcion: h.label,
        fechaComprometida: fecha(h.comprometido),
        fechaRecepcion: fecha(h.real),
        porcentaje: h.porcentaje,
        moneda: h.contrato.moneda,
        valorLiberado: h.pagoGenerado?.monto ?? 0,
        pagoId: h.pagoGenerado?.id ?? null,
      },
    };
  }

  async factura(facturaId: string, mapeos: Mapeos) {
    const f = await this.prisma.factura.findUnique({
      where: { id: facturaId },
      include: {
        pago: {
          include: {
            hitoOrigen: { select: { label: true } },
            proveedor: { select: { id: true, nit: true, nombre: true } },
            contrato: {
              include: { centroCosto: { select: { codigo: true } } },
            },
          },
        },
      },
    });
    if (!f) return null;
    const c = f.pago.contrato;
    const orden = formatContratoCodigo(c.tipo, c.numero);
    return {
      referencia: `Factura ${f.numero}`,
      datos: {
        id: f.id,
        numero: f.numero,
        estado: f.estado,
        fechaEmision: fecha(f.fechaEmision),
        fechaRadicacion: fecha(f.createdAt),
        fechaAprobacion: fecha(f.revisadaAt),
        fechaVencimiento: fecha(f.pago.fechaPagoPactada),
        proveedor: {
          id: f.pago.proveedor.id,
          nit: f.pago.proveedor.nit,
          razonSocial: f.pago.proveedor.nombre,
        },
        orden: { id: c.id, codigo: orden },
        concepto: f.pago.hitoOrigen?.label ?? null,
        moneda: f.pago.moneda,
        valor: f.monto,
        valorAPagar: f.pago.monto,
        centroCostoErp: c.centroCosto
          ? (mapeos.centro.get(c.centroCosto.codigo) ?? null)
          : null,
        cuentaErp: mapeos.categoria.get(c.categoria) ?? null,
        pagoId: f.pagoId,
      },
    };
  }

  async pago(pagoId: string) {
    const p = await this.prisma.pagoPO.findUnique({
      where: { id: pagoId },
      include: {
        proveedor: { select: { nit: true, nombre: true } },
        contrato: { select: { tipo: true, numero: true } },
        facturas: {
          where: { estado: 'APROBADA' },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!p || !p.fechaPago) return null;
    return {
      referencia: `Pago ${p.referenciaPago ?? p.id}`,
      datos: {
        id: p.id,
        orden: formatContratoCodigo(p.contrato.tipo, p.contrato.numero),
        factura: p.facturas[0]?.numero ?? null,
        proveedor: { nit: p.proveedor.nit, razonSocial: p.proveedor.nombre },
        moneda: p.moneda,
        valorPagado: p.montoPagado ?? p.monto,
        fechaPago: fecha(p.fechaPago),
        referencia: p.referenciaPago,
      },
    };
  }

  async snapshot(tipo: TipoEventoErp, entidadId: string, mapeos: Mapeos) {
    switch (tipo) {
      case TipoEventoErp.PROVEEDOR:
        return this.proveedor(entidadId);
      case TipoEventoErp.ORDEN_COMPRA:
        return this.ordenCompra(entidadId, mapeos);
      case TipoEventoErp.RECEPCION:
        return this.recepcion(entidadId);
      case TipoEventoErp.FACTURA:
        return this.factura(entidadId, mapeos);
      case TipoEventoErp.PAGO:
        return this.pago(entidadId);
    }
  }

  // ----------------------------------------------------------------- outbox

  /**
   * Queues (or re-queues with a new version) the document for the ERP when
   * the company has an active integration. It never throws: a sync problem
   * must not undo a signed contract or an approved invoice — it shows up in
   * the sync screen instead.
   */
  async emitir(companyId: string, tipo: TipoEventoErp, entidadId: string) {
    try {
      const integracion = await this.prisma.integracionErp.findUnique({
        where: { companyId },
      });
      if (!integracion?.activa) return;
      if (integracion.eventos.length && !integracion.eventos.includes(tipo))
        return;
      if (integracion.modo === ModoIntegracion.SIIGO) {
        // Siigo has no purchase-order API, and payments made in Siigo are
        // read back instead of sent.
        if (!TIPOS_SIIGO.includes(tipo)) return;
        if (
          tipo === TipoEventoErp.PAGO &&
          configSiigo(integracion.conectorConfig).pagosDesde === 'SIIGO'
        )
          return;
      }
      const mapeos = await this.mapeos(companyId);
      const snap = await this.snapshot(tipo, entidadId, mapeos);
      if (!snap) return;
      const payload = snap.datos as unknown as Prisma.InputJsonValue;
      await this.prisma.eventoErp.upsert({
        where: { companyId_tipo_entidadId: { companyId, tipo, entidadId } },
        create: {
          companyId,
          tipo,
          entidadId,
          referencia: snap.referencia,
          payload,
        },
        update: {
          referencia: snap.referencia,
          payload,
          version: { increment: 1 },
          estado: EstadoEventoErp.PENDIENTE,
          intentos: 0,
          proximoIntento: new Date(),
          ultimoError: null,
        },
      });
    } catch (err) {
      this.logger.error(
        `No se pudo encolar ${tipo} ${entidadId} para el ERP`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  /** A purchase order needs its supplier to exist in the ERP first. */
  async emitirOrden(companyId: string, contratoId: string) {
    const c = await this.prisma.contrato.findUnique({
      where: { id: contratoId },
      select: { proveedorId: true },
    });
    if (c?.proveedorId)
      await this.emitir(companyId, TipoEventoErp.PROVEEDOR, c.proveedorId);
    await this.emitir(companyId, TipoEventoErp.ORDEN_COMPRA, contratoId);
  }
}
