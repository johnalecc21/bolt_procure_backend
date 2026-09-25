import { agregar, hojasVacias } from './erp.filas';

describe('filas del archivo para el ERP', () => {
  it('una orden llena la hoja de órdenes y la de líneas', () => {
    const h = hojasVacias();
    agregar(h, 'ORDEN_COMPRA', {
      id: 'c1',
      codigo: 'PO-0007',
      numeroOrdenCompra: 'PO-2026-0012',
      tipo: 'PO',
      estado: 'ACTIVO',
      anulada: false,
      contratoMarco: null,
      requerimiento: { codigo: 'REQ-0012' },
      proveedor: { nit: '900123', razonSocial: 'Acme SAS' },
      fechaFirma: '2026-09-01',
      vigenciaInicio: '2026-09-01',
      vigenciaFin: '2027-09-01',
      moneda: 'COP',
      valorTotal: 1000,
      condicionesPagoDias: 30,
      centroCosto: { codigo: 'MTO', codigoErp: '1105' },
      categoria: { nombre: 'TI', cuentaErp: '5195' },
      lineas: [
        {
          linea: 1,
          descripcion: 'Portátil',
          cantidad: 2,
          unidad: 'und',
          precioUnitario: 500,
          subtotal: 1000,
        },
      ],
    });
    expect(h.ordenes[0]).toMatchObject({
      codigo: 'PO-0007',
      nit_proveedor: '900123',
      centro_costo_erp: '1105',
      cuenta_erp: '5195',
    });
    expect(h.lineas).toEqual([
      {
        codigo_orden: 'PO-0007',
        linea: 1,
        descripcion: 'Portátil',
        cantidad: 2,
        unidad: 'und',
        precio_unitario: 500,
        subtotal: 1000,
        moneda: 'COP',
      },
    ]);
  });

  it('factura y pago usan columnas estables', () => {
    const h = hojasVacias();
    agregar(h, 'FACTURA', {
      id: 'f',
      numero: 'FE-1',
      proveedor: { nit: '9', razonSocial: 'X' },
      orden: { codigo: 'PO-1' },
      valor: 10,
      valorAPagar: 10,
      moneda: 'COP',
      pagoId: 'p',
    });
    agregar(h, 'PAGO', {
      id: 'p',
      orden: 'PO-1',
      factura: 'FE-1',
      proveedor: { nit: '9', razonSocial: 'X' },
      moneda: 'COP',
      valorPagado: 9,
      fechaPago: '2026-09-20',
      referencia: 'TRX',
    });
    expect(Object.keys(h.facturas[0])).toContain('valor_a_pagar');
    expect(h.pagos[0]).toMatchObject({
      numero_factura: 'FE-1',
      valor_pagado: 9,
      referencia: 'TRX',
    });
  });
});
