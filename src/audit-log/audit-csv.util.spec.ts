import { csvCampo, csvFila, fechaCorte } from './audit-csv.util';

describe('audit CSV', () => {
  it('quotes separators, quotes and newlines', () => {
    expect(csvCampo('simple')).toBe('simple');
    expect(csvCampo('a, b')).toBe('"a, b"');
    expect(csvCampo('dijo "hola"')).toBe('"dijo ""hola"""');
    expect(csvCampo('línea 1\nlínea 2')).toBe('"línea 1\nlínea 2"');
  });

  it('neutralizes spreadsheet formulas (CSV injection)', () => {
    expect(csvCampo('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCampo('+57 300')).toBe("'+57 300");
    expect(csvCampo('-10')).toBe("'-10");
  });

  it('writes one row per entry with an ISO date', () => {
    const fila = csvFila({
      createdAt: new Date('2026-09-01T12:00:00Z'),
      usuario: 'ana@acme.com',
      accion: 'Aprobó',
      detalle: 'REQ-0001',
      motivo: null,
    });
    expect(fila).toBe('2026-09-01T12:00:00.000Z,ana@acme.com,Aprobó,REQ-0001,');
  });

  it('computes the retention cutoff in months', () => {
    expect(
      fechaCorte(12, new Date('2026-09-23T00:00:00Z'))
        .toISOString()
        .slice(0, 7),
    ).toBe('2025-09');
  });
});
