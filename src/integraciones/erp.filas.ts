/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- snapshots are validated JSON built by ErpEventosService 
/**
 * Flat rows for the import file (one sheet per kind), built from the same
 * snapshots the webhook sends — so a file import and a live integration
 * receive identical data. Column names are stable: ERPs map them once.
 */
export type Fila = Record<string, string | number | boolean | null>;

export interface HojasErp {
  terceros: Fila[];
  ordenes: Fila[];
  lineas: Fila[];
  recepciones: Fila[];
  facturas: Fila[];
  pagos: Fila[];
}

export const hojasVacias = (): HojasErp => ({
  terceros: [],
  ordenes: [],
  lineas: [],
  recepciones: [],
  facturas: [],
  pagos: [],
});

export function filaTercero(d: any): Fila {
  return {
    id_procurex: d.id,
    nit: d.nit,
    razon_social: d.razonSocial,
    email: d.email,
    telefono: d.telefono,
    ubicacion: d.ubicacion,
  };
}

export function filasOrden(d: any): { orden: Fila; lineas: Fila[] } {
  return {
    orden: {
      id_procurex: d.id,
      codigo: d.codigo,
      numero_oc: d.numeroOrdenCompra,
      tipo: d.tipo,
      estado: d.estado,
      anulada: d.anulada,
      contrato_marco: d.contratoMarco?.codigo ?? null,
      requerimiento: d.requerimiento?.codigo ?? null,
      nit_proveedor: d.proveedor.nit,
      proveedor: d.proveedor.razonSocial,
      fecha_firma: d.fechaFirma,
      vigencia_inicio: d.vigenciaInicio,
      vigencia_fin: d.vigenciaFin,
      moneda: d.moneda,
      valor_total: d.valorTotal,
      dias_pago: d.condicionesPagoDias,
      centro_costo: d.centroCosto?.codigo ?? null,
      centro_costo_erp: d.centroCosto?.codigoErp ?? null,
      categoria: d.categoria.nombre,
      cuenta_erp: d.categoria.cuentaErp,
    },
    lineas: d.lineas.map((l: any) => ({
      codigo_orden: d.codigo,
      linea: l.linea,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      unidad: l.unidad,
      precio_unitario: l.precioUnitario,
      subtotal: l.subtotal,
      moneda: d.moneda,
    })),
  };
}

export function filaRecepcion(d: any): Fila {
  return {
    id_procurex: d.id,
    codigo_orden: d.orden.codigo,
    nit_proveedor: d.proveedor.nit,
    descripcion: d.descripcion,
    fecha_comprometida: d.fechaComprometida,
    fecha_recepcion: d.fechaRecepcion,
    porcentaje: d.porcentaje,
    moneda: d.moneda,
    valor_liberado: d.valorLiberado,
  };
}

export function filaFactura(d: any): Fila {
  return {
    id_procurex: d.id,
    numero_factura: d.numero,
    nit_proveedor: d.proveedor.nit,
    proveedor: d.proveedor.razonSocial,
    codigo_orden: d.orden.codigo,
    concepto: d.concepto,
    fecha_emision: d.fechaEmision,
    fecha_radicacion: d.fechaRadicacion,
    fecha_aprobacion: d.fechaAprobacion,
    fecha_vencimiento: d.fechaVencimiento,
    moneda: d.moneda,
    valor: d.valor,
    valor_a_pagar: d.valorAPagar,
    centro_costo_erp: d.centroCostoErp,
    cuenta_erp: d.cuentaErp,
    id_pago: d.pagoId,
  };
}

export function filaPago(d: any): Fila {
  return {
    id_procurex: d.id,
    codigo_orden: d.orden,
    numero_factura: d.factura,
    nit_proveedor: d.proveedor.nit,
    proveedor: d.proveedor.razonSocial,
    moneda: d.moneda,
    valor_pagado: d.valorPagado,
    fecha_pago: d.fechaPago,
    referencia: d.referencia,
  };
}

/** Adds one snapshot to the right sheet(s). */
export function agregar(hojas: HojasErp, tipo: string, datos: any) {
  switch (tipo) {
    case 'PROVEEDOR':
      hojas.terceros.push(filaTercero(datos));
      break;
    case 'ORDEN_COMPRA': {
      const { orden, lineas } = filasOrden(datos);
      hojas.ordenes.push(orden);
      hojas.lineas.push(...lineas);
      break;
    }
    case 'RECEPCION':
      hojas.recepciones.push(filaRecepcion(datos));
      break;
    case 'FACTURA':
      hojas.facturas.push(filaFactura(datos));
      break;
    case 'PAGO':
      hojas.pagos.push(filaPago(datos));
      break;
  }
}
