import { TipoEventoErp } from '@prisma/client';

/**
 * Pure translation from Procurex snapshots to Siigo Nube API bodies. Kept
 * free of I/O so every rule (NIT check digit, invoice prefix, amounts) is
 * unit-tested.
 */

/** What Siigo can receive: it has no purchase-order or receipt API. */
export const TIPOS_SIIGO: TipoEventoErp[] = [
  TipoEventoErp.PROVEEDOR,
  TipoEventoErp.FACTURA,
  TipoEventoErp.PAGO,
];

export type PagosDesde = 'PROCUREX' | 'SIIGO';

export interface ConfigSiigo {
  usuario?: string;
  /** Document type (FC) for purchase invoices. */
  documentoCompraId?: number | null;
  /** Payment type (CxP / crédito) the invoice is left owed with. */
  formaPagoCompraId?: number | null;
  /** Expense account when the category has no mapped account. */
  cuentaDefecto?: string | null;
  /** VAT to split out of the invoiced amount (value is VAT-included). */
  impuestoId?: number | null;
  /** Document type (RP) for disbursements. */
  documentoEgresoId?: number | null;
  /** Payment type (bank account) disbursements come out of. */
  formaPagoEgresoId?: number | null;
  /** DANE codes for suppliers created from Procurex. */
  departamento?: string;
  ciudad?: string;
  responsabilidadFiscal?: string;
  /** Who records payments: Procurex sends them, or Procurex reads them. */
  pagosDesde?: PagosDesde;
}

export const CONFIG_SIIGO_DEFECTO: Required<
  Pick<
    ConfigSiigo,
    'departamento' | 'ciudad' | 'responsabilidadFiscal' | 'pagosDesde'
  >
> = {
  departamento: '11',
  ciudad: '11001',
  responsabilidadFiscal: 'R-99-PN',
  pagosDesde: 'PROCUREX',
};

export function configSiigo(json: unknown): ConfigSiigo {
  const c = (json && typeof json === 'object' ? json : {}) as ConfigSiigo;
  return { ...CONFIG_SIIGO_DEFECTO, ...c };
}

/** What is still missing to send documents; empty = ready. */
export function faltantesSiigo(c: ConfigSiigo, tieneCredencial: boolean) {
  const f: string[] = [];
  if (!c.usuario?.trim()) f.push('usuario de la API');
  if (!tieneCredencial) f.push('access key');
  if (!c.documentoCompraId) f.push('tipo de factura de compra');
  if (!c.formaPagoCompraId) f.push('forma de pago de la factura');
  if (!c.cuentaDefecto?.trim()) f.push('cuenta contable por defecto');
  if (c.pagosDesde !== 'SIIGO') {
    if (!c.documentoEgresoId) f.push('tipo de comprobante de egreso');
    if (!c.formaPagoEgresoId) f.push('cuenta o forma de pago del egreso');
  }
  return f;
}

// -------------------------------------------------------------------- NIT

const PESOS_DV = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

/** DIAN check digit of a NIT (without the digit). */
export function digitoVerificacion(nit: string): string {
  const d = nit.replace(/\D/g, '');
  let suma = 0;
  for (let i = 0; i < d.length; i++)
    suma += Number(d[d.length - 1 - i]) * PESOS_DV[i];
  const r = suma % 11;
  return String(r > 1 ? 11 - r : r);
}

/**
 * "900.123.456-7", "900123456 7" or "900123456" → base number and check
 * digit (always recomputed: a mistyped DV would make Siigo reject it).
 */
export function separarNit(nit: string | null | undefined) {
  if (!nit) return null;
  const limpio = nit.trim();
  const conDv = /^([\d.\s]+)[-\s](\d)$/.exec(limpio);
  const base = (conDv ? conDv[1] : limpio).replace(/\D/g, '');
  if (base.length < 3 || base.length > 13) return null;
  return { base, dv: digitoVerificacion(base) };
}

/** Company NITs start with 8 or 9; others are people registered with a NIT. */
export function esPersonaJuridica(base: string) {
  return base.startsWith('8') || base.startsWith('9');
}

// ------------------------------------------------------------------ bodies

interface ProveedorSnap {
  nit: string | null;
  razonSocial: string;
  email: string | null;
  telefono: string | null;
  ubicacion: string | null;
}

const recortar = (s: string, n: number) => s.trim().slice(0, n);

export function cuerpoTercero(p: ProveedorSnap, c: ConfigSiigo) {
  const nit = separarNit(p.nit);
  if (!nit)
    throw new ErrorDatos(
      `El proveedor ${p.razonSocial} no tiene un NIT válido en su perfil.`,
    );
  const juridica = esPersonaJuridica(nit.base);
  const nombre = recortar(p.razonSocial, 100);
  let name = [nombre];
  if (!juridica) {
    const partes = nombre.split(/\s+/);
    const mitad = Math.max(1, Math.ceil(partes.length / 2));
    name = [
      partes.slice(0, mitad).join(' '),
      partes.slice(mitad).join(' ') || '.',
    ];
  }
  const numero = (p.telefono ?? '').replace(/\D/g, '').slice(-10);
  const cfg = configSiigo(c);
  return {
    type: 'Supplier',
    person_type: juridica ? 'Company' : 'Person',
    id_type: '31',
    identification: nit.base,
    check_digit: nit.dv,
    name,
    commercial_name: nombre,
    branch_office: 0,
    active: true,
    vat_responsible: false,
    fiscal_responsibilities: [{ code: cfg.responsabilidadFiscal }],
    address: {
      address: recortar(p.ubicacion || 'Sin dirección', 256),
      city: {
        country_code: 'Co',
        state_code: cfg.departamento,
        city_code: cfg.ciudad,
      },
    },
    ...(numero ? { phones: [{ indicative: '57', number: numero }] } : {}),
    contacts: [
      {
        first_name: recortar(nombre, 50),
        ...(p.email ? { email: p.email.slice(0, 100) } : {}),
        ...(numero ? { phone: { indicative: '57', number: numero } } : {}),
      },
    ],
    comments: 'Creado desde Procurex',
  };
}

/**
 * Supplier invoice number → Siigo's prefix + number: "FE-1234" → FE / 1234,
 * "SETT 990001" → SETT / 990001, "1234" → SP / 1234 (sin prefijo).
 */
export function partirFacturaProveedor(numero: string) {
  const limpio = numero.trim().toUpperCase();
  const m = /^([A-Z0-9]*?[A-Z][A-Z0-9]*?)[\s\-_/]*(\d+)$/.exec(limpio);
  if (m) {
    return {
      prefix: m[1].replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'SP',
      number: m[2].slice(-11),
    };
  }
  const digitos = limpio.replace(/\D/g, '');
  return { prefix: 'SP', number: (digitos || '0').slice(-11) };
}

/** Marker in "observations" to find our own documents after a timeout. */
export const marcador = (tipo: string, id: string) =>
  `[procurex:${tipo}:${id}]`;

interface FacturaSnap {
  id: string;
  numero: string;
  fechaEmision: string | null;
  fechaVencimiento: string | null;
  fechaAprobacion: string | null;
  proveedor: { nit: string | null; razonSocial: string };
  orden: { codigo: string };
  concepto: string | null;
  valor: number;
  cuentaErp: string | null;
}

export function cuerpoCompra(
  f: FacturaSnap,
  c: ConfigSiigo,
  costCenterId: number | null,
) {
  const nit = separarNit(f.proveedor.nit);
  if (!nit)
    throw new ErrorDatos(
      `El proveedor ${f.proveedor.razonSocial} no tiene un NIT válido en su perfil.`,
    );
  const cuenta = f.cuentaErp?.trim() || c.cuentaDefecto?.trim();
  if (!cuenta)
    throw new ErrorDatos(
      'Configura la cuenta contable por defecto o mapea la categoría.',
    );
  const fecha =
    f.fechaEmision ??
    f.fechaAprobacion ??
    new Date().toISOString().slice(0, 10);
  const descripcion = recortar(
    [f.orden.codigo, f.concepto].filter(Boolean).join(' · '),
    4000,
  );
  return {
    document: { id: c.documentoCompraId },
    date: fecha,
    supplier: { identification: nit.base, branch_office: 0 },
    ...(costCenterId ? { cost_center: costCenterId } : {}),
    provider_invoice: partirFacturaProveedor(f.numero),
    discount_type: 'Value',
    tax_included: !!c.impuestoId,
    observations: recortar(
      `Procurex ${f.orden.codigo} · factura ${f.numero} ${marcador('factura', f.id)}`,
      4000,
    ),
    items: [
      {
        type: 'Account',
        code: cuenta,
        description: descripcion || `Factura ${f.numero}`,
        quantity: 1,
        price: f.valor,
        discount: 0,
        ...(c.impuestoId ? { taxes: [{ id: c.impuestoId }] } : {}),
      },
    ],
    payments: [
      {
        id: c.formaPagoCompraId,
        // With VAT included the invoice total is exactly the invoiced value.
        value: f.valor,
        ...(f.fechaVencimiento ? { due_date: f.fechaVencimiento } : {}),
      },
    ],
  };
}

export interface CuotaSiigo {
  prefix: string;
  consecutive: number;
  quote: number;
  date: string;
  balance: number;
}

export function cuerpoEgreso(args: {
  pagoId: string;
  nit: string;
  fechaPago: string;
  cuota: CuotaSiigo;
  valorPagado: number;
  referencia: string | null;
  factura: string;
  c: ConfigSiigo;
}) {
  const { c, cuota } = args;
  return {
    document: { id: c.documentoEgresoId },
    date: args.fechaPago,
    type: 'DebtPayment',
    supplier: { identification: args.nit, branch_office: 0 },
    items: [
      {
        due: {
          prefix: cuota.prefix,
          consecutive: cuota.consecutive,
          quote: cuota.quote,
          date: cuota.date,
        },
        value: args.valorPagado,
      },
    ],
    payment: { id: c.formaPagoEgresoId, value: args.valorPagado },
    observations: recortar(
      `Procurex pago factura ${args.factura}${args.referencia ? ` · ref ${args.referencia}` : ''} ${marcador('pago', args.pagoId)}`,
      4000,
    ),
  };
}

/** Data problems the user must fix in Procurex (not a connection issue). */
export class ErrorDatos extends Error {}
