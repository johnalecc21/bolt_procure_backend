/**
 * The placeholders a company can use in its Word templates, and the data
 * shape they are filled from. One catalog drives validation on upload, the
 * guide shown on screen, the sample template and the preview data.
 */

export interface Marcador {
  /** Path as written in Word, without braces: "proveedor.nit". */
  clave: string;
  descripcion: string;
  ejemplo: string;
}

export interface GrupoMarcadores {
  titulo: string;
  /** Set for repeated blocks ({{#lineas}}…{{/lineas}}); fields are relative. */
  bucle?: string;
  marcadores: Marcador[];
}

export const GRUPOS_MARCADORES: GrupoMarcadores[] = [
  {
    titulo: 'Tu empresa (contratante)',
    marcadores: [
      {
        clave: 'empresa.razonSocial',
        descripcion: 'Razón social',
        ejemplo: 'Acme S.A.S.',
      },
      { clave: 'empresa.nit', descripcion: 'NIT', ejemplo: '900.123.456-7' },
      {
        clave: 'empresa.direccion',
        descripcion: 'Dirección',
        ejemplo: 'Cra 7 # 71-21',
      },
      {
        clave: 'empresa.ciudad',
        descripcion: 'Ciudad',
        ejemplo: 'Bogotá D.C.',
      },
      {
        clave: 'empresa.telefono',
        descripcion: 'Teléfono',
        ejemplo: '601 555 0100',
      },
      {
        clave: 'empresa.email',
        descripcion: 'Correo',
        ejemplo: 'compras@acme.co',
      },
      {
        clave: 'empresa.representanteLegal',
        descripcion: 'Representante legal',
        ejemplo: 'María Gómez',
      },
      {
        clave: 'empresa.cargoRepresentante',
        descripcion: 'Cargo del representante',
        ejemplo: 'Gerente General',
      },
    ],
  },
  {
    titulo: 'Proveedor (contratista)',
    marcadores: [
      {
        clave: 'proveedor.razonSocial',
        descripcion: 'Razón social',
        ejemplo: 'Montajes Industriales S.A.S.',
      },
      { clave: 'proveedor.nit', descripcion: 'NIT', ejemplo: '901.555.222-1' },
      {
        clave: 'proveedor.direccion',
        descripcion: 'Dirección / ubicación',
        ejemplo: 'Medellín, Antioquia',
      },
      {
        clave: 'proveedor.email',
        descripcion: 'Correo de contacto',
        ejemplo: 'ventas@montajes.co',
      },
      {
        clave: 'proveedor.telefono',
        descripcion: 'Teléfono',
        ejemplo: '604 444 1234',
      },
    ],
  },
  {
    titulo: 'Contrato u orden de compra',
    marcadores: [
      {
        clave: 'contrato.codigo',
        descripcion: 'Código en Procurex',
        ejemplo: 'PO-0042',
      },
      {
        clave: 'contrato.numeroOrdenCompra',
        descripcion: 'Número de orden de compra',
        ejemplo: 'PO-2026-0042',
      },
      {
        clave: 'contrato.tipo',
        descripcion: 'Tipo de documento',
        ejemplo: 'Orden de compra',
      },
      {
        clave: 'contrato.objeto',
        descripcion: 'Objeto (título del requerimiento)',
        ejemplo: 'Suministro de rodamientos para planta norte',
      },
      {
        clave: 'contrato.descripcion',
        descripcion: 'Descripción del requerimiento',
        ejemplo: 'Rodamientos y correas para mantenimiento preventivo.',
      },
      {
        clave: 'contrato.categoria',
        descripcion: 'Categoría de compra',
        ejemplo: 'Mantenimiento',
      },
      {
        clave: 'contrato.requerimiento',
        descripcion: 'Código del requerimiento',
        ejemplo: 'REQ-0012',
      },
      {
        clave: 'contrato.contratoMarco',
        descripcion: 'Contrato marco del que se emite (si aplica)',
        ejemplo: 'CTO-0007',
      },
      {
        clave: 'contrato.centroCosto',
        descripcion: 'Centro de costo',
        ejemplo: 'MTO · Mantenimiento',
      },
      {
        clave: 'contrato.fechaFirma',
        descripcion: 'Fecha de firma',
        ejemplo: '25 de septiembre de 2026',
      },
      {
        clave: 'contrato.vigenciaInicio',
        descripcion: 'Inicio de vigencia',
        ejemplo: '25 de septiembre de 2026',
      },
      {
        clave: 'contrato.vigenciaFin',
        descripcion: 'Fin de vigencia',
        ejemplo: '25 de septiembre de 2027',
      },
      {
        clave: 'contrato.duracionDias',
        descripcion: 'Duración en días',
        ejemplo: '365',
      },
      { clave: 'contrato.moneda', descripcion: 'Moneda', ejemplo: 'COP' },
      {
        clave: 'contrato.valor',
        descripcion: 'Valor con formato',
        ejemplo: '$ 15.000.000',
      },
      {
        clave: 'contrato.valorEnLetras',
        descripcion: 'Valor en letras',
        ejemplo: 'QUINCE MILLONES DE PESOS M/CTE',
      },
      {
        clave: 'contrato.condicionesPagoDias',
        descripcion: 'Días de pago',
        ejemplo: '30',
      },
      {
        clave: 'contrato.plazoEntregaDias',
        descripcion: 'Plazo de entrega (días)',
        ejemplo: '15',
      },
      {
        clave: 'contrato.garantiaMeses',
        descripcion: 'Garantía (meses)',
        ejemplo: '12',
      },
      { clave: 'contrato.estado', descripcion: 'Estado', ejemplo: 'Activo' },
    ],
  },
  {
    titulo: 'Ítems (tabla que se repite por cada línea)',
    bucle: 'lineas',
    marcadores: [
      { clave: 'numero', descripcion: 'Número de línea', ejemplo: '1' },
      {
        clave: 'descripcion',
        descripcion: 'Descripción',
        ejemplo: 'Rodamiento 6204',
      },
      {
        clave: 'especificacion',
        descripcion: 'Especificación',
        ejemplo: 'SKF o equivalente',
      },
      { clave: 'cantidad', descripcion: 'Cantidad', ejemplo: '10' },
      { clave: 'unidad', descripcion: 'Unidad', ejemplo: 'und' },
      {
        clave: 'precioUnitario',
        descripcion: 'Precio unitario',
        ejemplo: '$ 1.500.000',
      },
      { clave: 'subtotal', descripcion: 'Subtotal', ejemplo: '$ 15.000.000' },
    ],
  },
  {
    titulo: 'Hitos de entrega y pago (se repiten)',
    bucle: 'hitos',
    marcadores: [
      { clave: 'numero', descripcion: 'Número', ejemplo: '1' },
      {
        clave: 'descripcion',
        descripcion: 'Descripción',
        ejemplo: 'Entrega total',
      },
      {
        clave: 'fecha',
        descripcion: 'Fecha comprometida',
        ejemplo: '10 de octubre de 2026',
      },
      {
        clave: 'porcentaje',
        descripcion: '% del valor que se paga',
        ejemplo: '100',
      },
      {
        clave: 'valor',
        descripcion: 'Valor que se paga',
        ejemplo: '$ 15.000.000',
      },
    ],
  },
  {
    titulo: 'Modificaciones (otrosíes, se repiten)',
    bucle: 'modificaciones',
    marcadores: [
      { clave: 'fecha', descripcion: 'Fecha', ejemplo: '1 de marzo de 2027' },
      { clave: 'tipo', descripcion: 'Tipo', ejemplo: 'Prórroga' },
      {
        clave: 'detalle',
        descripcion: 'Qué cambió',
        ejemplo: 'Vigencia hasta el 30 de junio de 2027',
      },
      {
        clave: 'motivo',
        descripcion: 'Motivo',
        ejemplo: 'Ampliación del plazo de obra',
      },
    ],
  },
  {
    titulo: 'Penalidad por incumplimiento (Marca y datos)',
    marcadores: [
      {
        clave: 'penalidad.texto',
        descripcion: 'Cláusula redactada por tu empresa',
        ejemplo: 'En caso de atraso injustificado…',
      },
      {
        clave: 'penalidad.porcentajeDiario',
        descripcion: '% por día de atraso',
        ejemplo: '0,5',
      },
      {
        clave: 'penalidad.tope',
        descripcion: 'Tope, % del valor del contrato',
        ejemplo: '10',
      },
      {
        clave: 'penalidad.diasGracia',
        descripcion: 'Días de gracia',
        ejemplo: '0',
      },
      {
        clave: 'penalidad.base',
        descripcion: 'Sobre qué se calcula',
        ejemplo: 'el valor del hito atrasado',
      },
    ],
  },
  {
    titulo: 'Otros',
    marcadores: [
      {
        clave: 'clausulas',
        descripcion: 'Cláusulas de la empresa (Plantillas › Marca)',
        ejemplo: 'PRIMERA. Confidencialidad…',
      },
      {
        clave: 'fechaGeneracion',
        descripcion: 'Fecha en que se generó el documento',
        ejemplo: '25 de septiembre de 2026',
      },
    ],
  },
];

/** Every valid placeholder path: "proveedor.nit", "lineas.descripcion"… */
export const CLAVES_VALIDAS = new Set(
  GRUPOS_MARCADORES.flatMap((g) =>
    g.marcadores.map((m) => (g.bucle ? `${g.bucle}.${m.clave}` : m.clave)),
  ),
);
export const BUCLES = new Set(
  GRUPOS_MARCADORES.map((g) => g.bucle).filter((b): b is string => !!b),
);
/** Sections usable as conditionals: {{#contrato.contratoMarco}}…{{/contrato.contratoMarco}}. */
export const SECCIONES = new Set([...BUCLES, ...CLAVES_VALIDAS]);

/** What a legally usable document can't be missing: warned, not blocked. */
export const RECOMENDADOS: [string[], string][] = [
  [['proveedor.razonSocial'], 'la razón social del proveedor'],
  [['proveedor.nit'], 'el NIT del proveedor'],
  [['contrato.valor', 'contrato.valorEnLetras'], 'el valor'],
  [
    ['contrato.codigo', 'contrato.numeroOrdenCompra'],
    'el número del documento',
  ],
];

// ------------------------------------------------------------- formatos

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** "25 de septiembre de 2026" (the date as stored, in UTC). */
export function fechaLarga(d: Date | null | undefined) {
  if (!d) return '';
  return `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

export function dinero(valor: number, moneda: string) {
  const n = Math.round(valor).toLocaleString('es-CO');
  return moneda === 'COP' ? `$ ${n}` : `${moneda} ${n}`;
}

export function numero(n: number) {
  return n.toLocaleString('es-CO', { maximumFractionDigits: 3 });
}

const UNIDADES = [
  '',
  'UNO',
  'DOS',
  'TRES',
  'CUATRO',
  'CINCO',
  'SEIS',
  'SIETE',
  'OCHO',
  'NUEVE',
  'DIEZ',
  'ONCE',
  'DOCE',
  'TRECE',
  'CATORCE',
  'QUINCE',
  'DIECISÉIS',
  'DIECISIETE',
  'DIECIOCHO',
  'DIECINUEVE',
  'VEINTE',
  'VEINTIUNO',
  'VEINTIDÓS',
  'VEINTITRÉS',
  'VEINTICUATRO',
  'VEINTICINCO',
  'VEINTISÉIS',
  'VEINTISIETE',
  'VEINTIOCHO',
  'VEINTINUEVE',
];
const DECENAS = [
  '',
  '',
  '',
  'TREINTA',
  'CUARENTA',
  'CINCUENTA',
  'SESENTA',
  'SETENTA',
  'OCHENTA',
  'NOVENTA',
];
const CENTENAS = [
  '',
  'CIENTO',
  'DOSCIENTOS',
  'TRESCIENTOS',
  'CUATROCIENTOS',
  'QUINIENTOS',
  'SEISCIENTOS',
  'SETECIENTOS',
  'OCHOCIENTOS',
  'NOVECIENTOS',
];

function menorMil(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  const c = Math.floor(n / 100);
  const r = n % 100;
  let dec = '';
  if (r < 30) dec = UNIDADES[r];
  else {
    const d = Math.floor(r / 10);
    const u = r % 10;
    dec = DECENAS[d] + (u ? ` Y ${UNIDADES[u]}` : '');
  }
  return [CENTENAS[c], dec].filter(Boolean).join(' ');
}

/** "UNO" becomes "UN" before a noun: "VEINTIÚN MILLONES", "UN MIL"… */
function apocope(s: string) {
  return s.replace(/VEINTIUNO$/, 'VEINTIÚN').replace(/UNO$/, 'UN');
}

/** Integer in Spanish words, as legal documents write amounts. */
export function enLetras(valor: number): string {
  let n = Math.floor(Math.abs(valor));
  if (n === 0) return 'CERO';
  const partes: string[] = [];
  const billones = Math.floor(n / 1e12);
  n %= 1e12;
  const millones = Math.floor(n / 1e6);
  n %= 1e6;
  const miles = Math.floor(n / 1000);
  const resto = n % 1000;
  if (billones)
    partes.push(
      billones === 1 ? 'UN BILLÓN' : `${apocope(enLetras(billones))} BILLONES`,
    );
  if (millones) {
    const texto = millones < 1000 ? menorMil(millones) : enLetras(millones);
    partes.push(millones === 1 ? 'UN MILLÓN' : `${apocope(texto)} MILLONES`);
  }
  if (miles)
    partes.push(miles === 1 ? 'MIL' : `${apocope(menorMil(miles))} MIL`);
  if (resto) partes.push(menorMil(resto));
  return partes.join(' ');
}

const NOMBRE_MONEDA: Record<string, [string, string]> = {
  COP: ['PESOS', 'M/CTE'],
  USD: ['DÓLARES', 'DE LOS ESTADOS UNIDOS DE AMÉRICA'],
  EUR: ['EUROS', ''],
  MXN: ['PESOS MEXICANOS', ''],
};

export function valorEnLetras(valor: number, moneda: string) {
  const [nombre, sufijo] = NOMBRE_MONEDA[moneda] ?? [moneda, ''];
  let texto = apocope(enLetras(valor));
  // "UN MILLÓN DE PESOS", "DOS MILLONES DE PESOS" but "MIL PESOS".
  if (/(MILLÓN|MILLONES|BILLÓN|BILLONES)$/.test(texto)) texto += ' DE';
  return [texto, nombre, sufijo].filter(Boolean).join(' ');
}

// ------------------------------------------------------------ contexto

export interface ContextoDocumento {
  empresa: Record<string, string>;
  proveedor: Record<string, string>;
  contrato: Record<string, string>;
  lineas: Record<string, string>[];
  hitos: Record<string, string>[];
  modificaciones: Record<string, string>[];
  /** Empty strings when the company has no penalty clause. */
  penalidad: Record<string, string>;
  clausulas: string;
  fechaGeneracion: string;
}

const pct = (n: number) =>
  n.toLocaleString('es-CO', { maximumFractionDigits: 3 });

/** The company's penalty settings as template text; all empty when off. */
export function contextoPenalidad(
  m: {
    penalidadActiva: boolean;
    penalidadDiaria: number | null;
    penalidadTope: number | null;
    penalidadDiasGracia: number;
    penalidadBase: string;
    penalidadTexto: string | null;
  } | null,
): Record<string, string> {
  if (!m?.penalidadActiva || !m.penalidadTexto?.trim())
    return {
      texto: '',
      porcentajeDiario: '',
      tope: '',
      diasGracia: '',
      base: '',
    };
  return {
    texto: m.penalidadTexto.trim(),
    porcentajeDiario: m.penalidadDiaria != null ? pct(m.penalidadDiaria) : '',
    tope: m.penalidadTope != null ? pct(m.penalidadTope) : '',
    diasGracia: String(m.penalidadDiasGracia),
    base:
      m.penalidadBase === 'CONTRATO'
        ? 'el valor total del contrato'
        : 'el valor del hito atrasado',
  };
}

/** Data for the preview when the company has no contract of that kind yet. */
export function contextoEjemplo(): ContextoDocumento {
  const plano = (grupo: string) =>
    Object.fromEntries(
      GRUPOS_MARCADORES.flatMap((g) => g.marcadores)
        .filter((m) => m.clave.startsWith(`${grupo}.`))
        .map((m) => [m.clave.slice(grupo.length + 1), m.ejemplo]),
    );
  const fila = (bucle: string) =>
    Object.fromEntries(
      GRUPOS_MARCADORES.find((g) => g.bucle === bucle)!.marcadores.map((m) => [
        m.clave,
        m.ejemplo,
      ]),
    );
  return {
    empresa: plano('empresa'),
    proveedor: plano('proveedor'),
    contrato: plano('contrato'),
    lineas: [
      fila('lineas'),
      {
        ...fila('lineas'),
        numero: '2',
        descripcion: 'Correa A-42',
        especificacion: '',
        cantidad: '25',
        precioUnitario: '$ 40.000',
        subtotal: '$ 1.000.000',
      },
    ],
    hitos: [fila('hitos')],
    modificaciones: [],
    penalidad: {
      texto:
        'En caso de atraso injustificado, el CONTRATISTA reconocerá una penalidad del 0,5 % del valor del hito atrasado por cada día calendario, hasta el 10 % del valor del contrato.',
      porcentajeDiario: '0,5',
      tope: '10',
      diasGracia: '0',
      base: 'el valor del hito atrasado',
    },
    clausulas:
      'PRIMERA. CONFIDENCIALIDAD. El contratista guardará reserva sobre la información recibida.\nSEGUNDA. INDEMNIDAD. El contratista mantendrá indemne al contratante.',
    fechaGeneracion: fechaLarga(new Date()),
  };
}
