import PizZip from 'pizzip';
import { inspeccionar, llenar, plantillaEjemplo } from './plantillas.motor';
import {
  contextoEjemplo,
  contextoPenalidad,
  enLetras,
  fechaLarga,
  valorEnLetras,
} from './plantillas.marcadores';

const texto = (docx: Buffer) =>
  new PizZip(docx)
    .file('word/document.xml')!
    .asText()
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

/** A minimal .docx whose body is the given paragraphs. */
function docx(...parrafos: string[]) {
  const base = new PizZip(plantillaEjemplo('ORDEN_COMPRA'));
  const cuerpo = parrafos
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`)
    .join('');
  base.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${cuerpo}</w:body></w:document>`,
  );
  return base.generate({ type: 'nodebuffer' });
}

describe('plantillas.motor', () => {
  it('the sample templates validate cleanly', () => {
    for (const tipo of ['ORDEN_COMPRA', 'CONTRATO_MARCO'] as const) {
      const r = inspeccionar(plantillaEjemplo(tipo));
      expect(r.errores).toEqual([]);
      expect(r.advertencias).toEqual([]);
      expect(r.marcadores).toEqual(
        expect.arrayContaining([
          'proveedor.nit',
          'lineas',
          'lineas.descripcion',
          'hitos.valor',
        ]),
      );
    }
  });

  it("Procurex's award letter validates and fills like a company template", () => {
    const base = plantillaEjemplo('CARTA_ADJUDICACION');
    const r = inspeccionar(base);
    expect(r.errores).toEqual([]);
    expect(r.advertencias).toEqual([]);
    expect(r.marcadores).toEqual(
      expect.arrayContaining(['adjudicacion.fecha', 'proveedor.nit', 'lineas']),
    );
    const t = texto(llenar(base, contextoEjemplo()));
    expect(t).toContain('Carta de adjudicación PO-2026-0042');
    expect(t).toContain('Montajes Industriales S.A.S.');
    expect(t).toContain('la totalidad del proceso');
    expect(t).toContain('Correa A-42');
    expect(t).not.toContain('{{');
  });

  it('fills fields, repeats table rows and prints conditionals', () => {
    const t = texto(
      llenar(plantillaEjemplo('ORDEN_COMPRA'), contextoEjemplo()),
    );
    expect(t).toContain('ORDEN DE COMPRA No. PO-2026-0042');
    expect(t).toContain('Montajes Industriales S.A.S.');
    expect(t).toContain('Rodamiento 6204');
    expect(t).toContain('Correa A-42');
    expect(t).toContain('contrato marco CTO-0007');
    expect(t).not.toContain('{{');
  });

  it('omits a conditional block when the value is empty', () => {
    const ctx = contextoEjemplo();
    ctx.contrato.contratoMarco = '';
    ctx.penalidad = contextoPenalidad(null);
    const t = texto(llenar(plantillaEjemplo('ORDEN_COMPRA'), ctx));
    expect(t).not.toContain('contrato marco');
    expect(t).not.toContain('PENALIDADES');
  });

  it('prints the penalty the company wrote, never a default one', () => {
    const base = {
      penalidadActiva: true,
      penalidadDiaria: 0.2,
      penalidadTope: 5,
      penalidadDiasGracia: 3,
      penalidadBase: 'CONTRATO',
      penalidadTexto: 'Multa del 0,2 % diario, máximo 5 %.',
    };
    expect(contextoPenalidad(base)).toEqual({
      texto: 'Multa del 0,2 % diario, máximo 5 %.',
      porcentajeDiario: '0,2',
      tope: '5',
      diasGracia: '3',
      base: 'el valor total del contrato',
    });
    expect(contextoPenalidad({ ...base, penalidadActiva: false }).texto).toBe(
      '',
    );
    expect(contextoPenalidad({ ...base, penalidadTexto: ' ' }).texto).toBe('');
    const ctx = contextoEjemplo();
    ctx.penalidad = contextoPenalidad(base);
    expect(texto(llenar(plantillaEjemplo('ORDEN_COMPRA'), ctx))).toContain(
      'PENALIDADES POR INCUMPLIMIENTO: Multa del 0,2 % diario, máximo 5 %.',
    );
  });

  it('rejects unknown placeholders with a readable message', () => {
    const r = inspeccionar(
      docx('Proveedor {{proveedor.nitt}} valor {{contrato.valor}}'),
    );
    expect(r.ok).toBe(false);
    expect(r.errores[0]).toContain('proveedor.nitt');
  });

  it('rejects broken syntax and non-Word files', () => {
    expect(inspeccionar(docx('Hola {{proveedor.nit')).ok).toBe(false);
    expect(inspeccionar(docx('{{#lineas}}{{descripcion}}')).errores[0]).toMatch(
      /lineas/,
    );
    expect(inspeccionar(Buffer.from('%PDF-1.4 nope')).errores[0]).toMatch(
      /Word/,
    );
  });

  it('warns (does not block) when key data is missing', () => {
    const r = inspeccionar(docx('Objeto: {{contrato.objeto}}'));
    expect(r.ok).toBe(true);
    expect(r.advertencias).toEqual(
      expect.arrayContaining([
        'La plantilla no incluye el NIT del proveedor.',
        'La plantilla no incluye el valor.',
      ]),
    );
  });

  it('writes amounts in Spanish words', () => {
    expect(enLetras(21)).toBe('VEINTIUNO');
    expect(enLetras(100)).toBe('CIEN');
    expect(enLetras(101000)).toBe('CIENTO UN MIL');
    expect(valorEnLetras(15_000_000, 'COP')).toBe(
      'QUINCE MILLONES DE PESOS M/CTE',
    );
    expect(valorEnLetras(21_500_000, 'COP')).toBe(
      'VEINTIÚN MILLONES QUINIENTOS MIL PESOS M/CTE',
    );
    expect(valorEnLetras(1_000_000, 'COP')).toBe('UN MILLÓN DE PESOS M/CTE');
    expect(valorEnLetras(1_234_567_890, 'COP')).toBe(
      'MIL DOSCIENTOS TREINTA Y CUATRO MILLONES QUINIENTOS SESENTA Y SIETE MIL OCHOCIENTOS NOVENTA PESOS M/CTE',
    );
    expect(valorEnLetras(2500, 'USD')).toBe(
      'DOS MIL QUINIENTOS DÓLARES DE LOS ESTADOS UNIDOS DE AMÉRICA',
    );
    expect(fechaLarga(new Date('2026-09-25T00:00:00Z'))).toBe(
      '25 de septiembre de 2026',
    );
  });
});
