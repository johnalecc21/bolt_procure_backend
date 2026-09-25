import {
  configSiigo,
  cuerpoCompra,
  cuerpoEgreso,
  cuerpoTercero,
  digitoVerificacion,
  ErrorDatos,
  faltantesSiigo,
  partirFacturaProveedor,
  separarNit,
} from './siigo.reglas';

describe('siigo.reglas', () => {
  it('computes the DIAN check digit', () => {
    expect(digitoVerificacion('860002964')).toBe('4');
    expect(digitoVerificacion('900373115')).toBe('3');
    expect(digitoVerificacion('800197268')).toBe('4');
    expect(digitoVerificacion('899999068')).toBe('1');
  });

  it('splits and recomputes NITs', () => {
    expect(separarNit('860.002.964-4')).toEqual({ base: '860002964', dv: '4' });
    expect(separarNit('860002964-9')).toEqual({ base: '860002964', dv: '4' });
    expect(separarNit('860002964')).toEqual({ base: '860002964', dv: '4' });
    expect(separarNit('')).toBeNull();
    expect(separarNit('12')).toBeNull();
  });

  it('splits supplier invoice numbers into prefix and number', () => {
    expect(partirFacturaProveedor('FE-1234')).toEqual({
      prefix: 'FE',
      number: '1234',
    });
    expect(partirFacturaProveedor('SETT 990001')).toEqual({
      prefix: 'SETT',
      number: '990001',
    });
    expect(partirFacturaProveedor('fv1-77')).toEqual({
      prefix: 'FV1',
      number: '77',
    });
    expect(partirFacturaProveedor('4501')).toEqual({
      prefix: 'SP',
      number: '4501',
    });
  });

  it('builds a supplier: company vs person, DV and DANE city', () => {
    const empresa = cuerpoTercero(
      {
        nit: '900373115',
        razonSocial: 'Aceros SAS',
        email: 'a@b.co',
        telefono: '+57 (601) 555-1234',
        ubicacion: 'Cra 1 # 2-3',
      },
      configSiigo({ ciudad: '05001', departamento: '05' }),
    );
    expect(empresa).toMatchObject({
      type: 'Supplier',
      person_type: 'Company',
      id_type: '31',
      identification: '900373115',
      check_digit: '3',
      name: ['Aceros SAS'],
      address: { city: { state_code: '05', city_code: '05001' } },
      phones: [{ number: '6015551234' }],
    });
    const persona = cuerpoTercero(
      {
        nit: '79123456',
        razonSocial: 'Juan Pérez Gómez',
        email: null,
        telefono: null,
        ubicacion: null,
      },
      configSiigo({}),
    );
    expect(persona.person_type).toBe('Person');
    expect(persona.name).toHaveLength(2);
    expect(() =>
      cuerpoTercero(
        {
          nit: null,
          razonSocial: 'X',
          email: null,
          telefono: null,
          ubicacion: null,
        },
        configSiigo({}),
      ),
    ).toThrow(ErrorDatos);
  });

  const factura = {
    id: 'f1',
    numero: 'FE-10',
    fechaEmision: '2026-09-01',
    fechaVencimiento: '2026-10-01',
    fechaAprobacion: '2026-09-02',
    proveedor: { nit: '900373115-3', razonSocial: 'Aceros' },
    orden: { codigo: 'PO-0007' },
    concepto: 'Anticipo',
    valor: 1_190_000,
    cuentaErp: null,
  };

  it('builds a purchase invoice with VAT included and the mapped account', () => {
    const c = configSiigo({
      documentoCompraId: 10,
      formaPagoCompraId: 20,
      cuentaDefecto: '51559501',
      impuestoId: 30,
    });
    const b = cuerpoCompra({ ...factura, cuentaErp: '52359501' }, c, 7);
    expect(b).toMatchObject({
      document: { id: 10 },
      date: '2026-09-01',
      supplier: { identification: '900373115' },
      cost_center: 7,
      provider_invoice: { prefix: 'FE', number: '10' },
      tax_included: true,
      items: [
        {
          type: 'Account',
          code: '52359501',
          price: 1_190_000,
          taxes: [{ id: 30 }],
        },
      ],
      payments: [{ id: 20, value: 1_190_000, due_date: '2026-10-01' }],
    });
    expect(b.observations).toContain('[procurex:factura:f1]');
    const sinIva = cuerpoCompra(factura, { ...c, impuestoId: null }, null);
    expect(sinIva.tax_included).toBe(false);
    expect(sinIva.items[0].code).toBe('51559501');
    expect('cost_center' in sinIva).toBe(false);
  });

  it('builds a disbursement against the open installment', () => {
    const cuota = {
      prefix: 'FC-1',
      consecutive: 73,
      quote: 1,
      date: '2026-10-01',
      balance: 1_000_000,
    };
    const base = {
      pagoId: 'p1',
      nit: '900373115',
      fechaPago: '2026-09-20',
      cuota,
      valorPagado: 1_000_000,
      referencia: 'TRX-1',
      factura: 'FE-10',
    };
    const cuerpo = cuerpoEgreso({
      ...base,
      c: configSiigo({ documentoEgresoId: 40, formaPagoEgresoId: 50 }),
    });
    expect(cuerpo).toMatchObject({
      type: 'DebtPayment',
      document: { id: 40 },
      items: [
        {
          due: { prefix: 'FC-1', consecutive: 73, quote: 1 },
          value: 1_000_000,
        },
      ],
      payment: { id: 50, value: 1_000_000 },
    });
  });

  it('lists what is missing depending on who records payments', () => {
    expect(faltantesSiigo(configSiigo({}), false)).toHaveLength(7);
    const lista = configSiigo({
      usuario: 'api@x.co',
      documentoCompraId: 1,
      formaPagoCompraId: 2,
      cuentaDefecto: '5195',
      pagosDesde: 'SIIGO',
    });
    expect(faltantesSiigo(lista, true)).toEqual([]);
    expect(faltantesSiigo({ ...lista, pagosDesde: 'PROCUREX' }, true)).toEqual([
      'tipo de comprobante de egreso',
      'cuenta o forma de pago del egreso',
    ]);
  });
});
