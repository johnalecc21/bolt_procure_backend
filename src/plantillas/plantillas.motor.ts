import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import InspectModule from 'docxtemplater/js/inspect-module.js';
import {
  BUCLES,
  CLAVES_VALIDAS,
  GRUPOS_MARCADORES,
  RECOMENDADOS,
  SECCIONES,
  type ContextoDocumento,
} from './plantillas.marcadores';

/**
 * Word (.docx) templates with {{placeholders}}: validation on upload and
 * filling on signing. Pure functions over buffers — no storage, no DB.
 */

/** Resolves dotted paths ("contrato.valor") against the current scope. */
function parser(tag: string) {
  const partes = tag === '.' ? [] : tag.split('.').map((p) => p.trim());
  return {
    get(scope: unknown): unknown {
      return partes.reduce<unknown>(
        (o, k) =>
          o && typeof o === 'object'
            ? (o as Record<string, unknown>)[k]
            : undefined,
        scope,
      );
    },
  };
}

const OPCIONES = {
  paragraphLoop: true,
  linebreaks: true,
  delimiters: { start: '{{', end: '}}' },
  parser,
  // Errors are returned to the user, not printed to the server log.
  errorLogging: false,
  // An empty field prints nothing instead of "undefined".
  nullGetter: () => '',
};

export interface ResultadoInspeccion {
  ok: boolean;
  marcadores: string[];
  errores: string[];
  advertencias: string[];
}

interface ErrorDocx {
  properties?: {
    id?: string;
    explanation?: string;
    xtag?: string;
    errors?: ErrorDocx[];
  };
  message?: string;
}

const MENSAJES: Record<string, (tag: string) => string> = {
  unopened_tag: (t) => `Hay un "}}" sin su "{{" de apertura cerca de "${t}".`,
  unclosed_tag: (t) => `El marcador "{{${t}" no está cerrado con "}}".`,
  duplicate_open_tag: (t) => `Hay dos "{{" seguidos cerca de "${t}".`,
  duplicate_close_tag: (t) => `Hay dos "}}" seguidos cerca de "${t}".`,
  closing_tag_does_not_match_opening_tag: (t) =>
    `El cierre "{{/${t}}}" no corresponde al bloque abierto.`,
  unclosed_loop: (t) => `El bloque "{{#${t}}}" no tiene su cierre "{{/${t}}}".`,
  unopened_loop: (t) =>
    `El cierre "{{/${t}}}" no tiene su apertura "{{#${t}}}".`,
  raw_xml_tag_should_be_only_text_in_paragraph: (t) =>
    `"{{@${t}}}" debe estar solo en su párrafo.`,
};

function mensajesDeError(err: unknown): string[] {
  const e = err as ErrorDocx;
  const lista = e.properties?.errors?.length ? e.properties.errors : [e];
  return lista.slice(0, 10).map((x) => {
    const id = x.properties?.id ?? '';
    const tag = (x.properties?.xtag ?? '').replace(/^[{#/\s]+|[}\s]+$/g, '');
    return (
      MENSAJES[id]?.(tag) ??
      x.properties?.explanation ??
      x.message ??
      'El archivo no es un documento de Word válido.'
    );
  });
}

function abrir(buffer: Buffer) {
  try {
    return new PizZip(buffer);
  } catch {
    return null;
  }
}

interface Parte {
  type: string;
  value: string;
  module?: string;
  subparsed?: Parte[];
}

/**
 * Placeholder paths used in the document. Inside a loop over lineas/hitos/
 * modificaciones fields are relative to the row ("lineas.descripcion");
 * inside a conditional block they stay absolute.
 */
function rutas(partes: Parte[], bucle = ''): string[] {
  return partes.flatMap((p) => {
    if (p.type !== 'placeholder') return [];
    const tag = p.value.trim();
    const ruta =
      bucle && !CLAVES_VALIDAS.has(tag) && !BUCLES.has(tag)
        ? `${bucle}.${tag}`
        : tag;
    if (p.module === 'loop')
      return [ruta, ...rutas(p.subparsed ?? [], BUCLES.has(tag) ? tag : bucle)];
    return [ruta];
  });
}

/**
 * Checks a template: it must open as .docx, compile (balanced braces and
 * blocks) and only use known placeholders. Missing key data is a warning.
 */
export function inspeccionar(buffer: Buffer): ResultadoInspeccion {
  const zip = abrir(buffer);
  if (!zip || !zip.file('word/document.xml'))
    return {
      ok: false,
      marcadores: [],
      errores: [
        'El archivo no es un documento de Word (.docx). Si es .doc, ábrelo en Word y guárdalo como .docx.',
      ],
      advertencias: [],
    };
  const inspector = new InspectModule();
  try {
    new Docxtemplater(zip, { ...OPCIONES, modules: [inspector] });
  } catch (err) {
    return {
      ok: false,
      marcadores: [],
      errores: mensajesDeError(err),
      advertencias: [],
    };
  }
  const encontradas = rutas(inspector.getAllStructuredTags());
  // A path is valid when it is a known field, a known loop or conditional,
  // or the parent of known fields ("contrato" in contrato.valor).
  const prefijos = new Set(
    [...CLAVES_VALIDAS].flatMap((c) =>
      c.split('.').map((_, i, a) => a.slice(0, i + 1).join('.')),
    ),
  );
  const desconocidas = [
    ...new Set(
      encontradas.filter(
        (r) => !CLAVES_VALIDAS.has(r) && !SECCIONES.has(r) && !prefijos.has(r),
      ),
    ),
  ];
  const hojas = encontradas.filter(
    (r) => CLAVES_VALIDAS.has(r) || BUCLES.has(r),
  );
  const errores = desconocidas.map(
    (r) =>
      `"{{${r}}}" no es un marcador válido. Revisa la ortografía en la guía de marcadores.`,
  );
  const advertencias = RECOMENDADOS.filter(
    ([claves]) => !claves.some((c) => encontradas.includes(c)),
  ).map(([, que]) => `La plantilla no incluye ${que}.`);
  if (hojas.length === 0)
    advertencias.unshift(
      'La plantilla no tiene ningún marcador: todos los documentos saldrán iguales.',
    );
  return {
    ok: errores.length === 0,
    marcadores: [...new Set(hojas)].sort(),
    errores,
    advertencias,
  };
}

/** Fills a validated template. */
export function llenar(buffer: Buffer, datos: ContextoDocumento): Buffer {
  const zip = new PizZip(buffer);
  const doc = new Docxtemplater(zip, OPCIONES);
  doc.render(datos);
  return doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });
}

// --------------------------------------------------------------- ejemplo

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function parrafo(
  texto: string,
  opts: { negrita?: boolean; tam?: number; centro?: boolean } = {},
) {
  const rpr = [
    opts.negrita ? '<w:b/>' : '',
    opts.tam ? `<w:sz w:val="${opts.tam}"/>` : '',
  ].join('');
  const ppr = opts.centro ? '<w:pPr><w:jc w:val="center"/></w:pPr>' : '';
  return `<w:p>${ppr}<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(texto)}</w:t></w:r></w:p>`;
}

function celda(texto: string, negrita = false) {
  return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${parrafo(texto, { negrita })}</w:tc>`;
}

function tabla(encabezados: string[], fila: string[]) {
  const borde =
    '<w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/>';
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${borde}</w:tblBorders></w:tblPr><w:tr>${encabezados.map((h) => celda(h, true)).join('')}</w:tr><w:tr>${fila.map((c) => celda(c)).join('')}</w:tr></w:tbl>`;
}

/** Two signature blocks side by side, in a borderless table. */
function firmas() {
  const bloque = (nombre: string, rol: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="2500" w:type="pct"/></w:tcPr>${parrafo('')}${parrafo('______________________________')}${parrafo(nombre, { negrita: true })}${parrafo(rol)}</w:tc>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tr>${bloque('{{empresa.representanteLegal}}', 'Contratante · {{empresa.razonSocial}}')}${bloque('{{proveedor.razonSocial}}', 'Contratista · NIT {{proveedor.nit}}')}</w:tr></w:tbl>`;
}

/**
 * A ready-to-edit sample: the company downloads it, restyles it in Word with
 * its letterhead and clauses, and uploads it back.
 */
export function plantillaEjemplo(
  tipo: 'CONTRATO_MARCO' | 'ORDEN_COMPRA',
): Buffer {
  const marco = tipo === 'CONTRATO_MARCO';
  const cuerpo = [
    parrafo('{{empresa.razonSocial}}', {
      negrita: true,
      tam: 28,
      centro: true,
    }),
    parrafo(
      'NIT {{empresa.nit}}{{#empresa.direccion}} · {{empresa.direccion}}{{/empresa.direccion}}{{#empresa.ciudad}} · {{empresa.ciudad}}{{/empresa.ciudad}}',
      { centro: true },
    ),
    parrafo(''),
    parrafo(
      marco
        ? 'CONTRATO MARCO No. {{contrato.codigo}}'
        : 'ORDEN DE COMPRA No. {{contrato.numeroOrdenCompra}}',
      { negrita: true, tam: 26, centro: true },
    ),
    parrafo('Fecha: {{contrato.fechaFirma}}'),
    parrafo(''),
    parrafo(
      'CONTRATANTE: {{empresa.razonSocial}}, NIT {{empresa.nit}}, representada por {{empresa.representanteLegal}}, {{empresa.cargoRepresentante}}.',
    ),
    parrafo(
      'CONTRATISTA: {{proveedor.razonSocial}}, NIT {{proveedor.nit}}, con domicilio en {{proveedor.direccion}}.',
    ),
    parrafo(''),
    parrafo('OBJETO: {{contrato.objeto}}. {{contrato.descripcion}}'),
    parrafo(
      '{{#contrato.contratoMarco}}Se emite en desarrollo del contrato marco {{contrato.contratoMarco}}.{{/contrato.contratoMarco}}',
    ),
    parrafo(
      `VALOR${marco ? ' MÁXIMO' : ''}: {{contrato.valor}} ({{contrato.valorEnLetras}}).`,
    ),
    parrafo(
      'VIGENCIA: del {{contrato.vigenciaInicio}} al {{contrato.vigenciaFin}}.',
    ),
    parrafo(
      'FORMA DE PAGO: a {{contrato.condicionesPagoDias}} días de radicada la factura, según los hitos recibidos a satisfacción.',
    ),
    parrafo(
      'GARANTÍA: {{contrato.garantiaMeses}} meses. PLAZO DE ENTREGA: {{contrato.plazoEntregaDias}} días.',
    ),
    parrafo(''),
    parrafo('ÍTEMS', { negrita: true }),
    tabla(
      ['#', 'Descripción', 'Cantidad', 'Unidad', 'Precio unitario', 'Subtotal'],
      [
        '{{#lineas}}{{numero}}',
        '{{descripcion}}',
        '{{cantidad}}',
        '{{unidad}}',
        '{{precioUnitario}}',
        '{{subtotal}}{{/lineas}}',
      ],
    ),
    parrafo(''),
    parrafo('HITOS DE ENTREGA Y PAGO', { negrita: true }),
    tabla(
      ['#', 'Hito', 'Fecha', '%', 'Valor'],
      [
        '{{#hitos}}{{numero}}',
        '{{descripcion}}',
        '{{fecha}}',
        '{{porcentaje}}',
        '{{valor}}{{/hitos}}',
      ],
    ),
    parrafo(''),
    parrafo('CLÁUSULAS', { negrita: true }),
    parrafo('{{clausulas}}'),
    parrafo(''),
    parrafo(
      '{{#modificaciones}}Modificación del {{fecha}} ({{tipo}}): {{detalle}}. {{/modificaciones}}',
    ),
    parrafo(''),
    firmas(),
  ].join('');
  const zip = new PizZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${cuerpo}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export { GRUPOS_MARCADORES };
