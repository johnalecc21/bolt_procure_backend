import {
  CategoriaDocumento,
  EstadoDocumento,
  EstadoHomologacion,
} from '@prisma/client';
import { categoriasFaltantes, esElegible } from './requisitos.util';

const ahora = new Date('2026-06-01');
const doc = (
  categoria: CategoriaDocumento,
  estado: EstadoDocumento,
  vigencia: Date | null = null,
) => ({
  categoria,
  estado,
  vigencia,
});

describe('requisitos de homologación', () => {
  const homologacion = {
    estado: EstadoHomologacion.APROBADO,
    documentos: [
      doc(CategoriaDocumento.LEGAL, EstadoDocumento.VALIDADO),
      doc(
        CategoriaDocumento.HSE,
        EstadoDocumento.VALIDADO,
        new Date('2026-01-01'),
      ),
      doc(CategoriaDocumento.LAFT, EstadoDocumento.SUBIDO),
    ],
  };

  it('keeps the original rule when the company requires nothing', () => {
    expect(esElegible(homologacion, [], ahora)).toBe(true);
    expect(
      esElegible(
        { ...homologacion, estado: EstadoHomologacion.ZONA_GRIS },
        [],
        ahora,
      ),
    ).toBe(false);
    expect(esElegible(null, [], ahora)).toBe(false);
  });

  it('requires a VALIDADO, unexpired document per required category', () => {
    expect(
      categoriasFaltantes(
        homologacion,
        [
          CategoriaDocumento.LEGAL,
          CategoriaDocumento.HSE,
          CategoriaDocumento.LAFT,
          CategoriaDocumento.SOSTENIBILIDAD,
        ],
        ahora,
      ),
    ).toEqual([
      CategoriaDocumento.HSE,
      CategoriaDocumento.LAFT,
      CategoriaDocumento.SOSTENIBILIDAD,
    ]);
    expect(esElegible(homologacion, [CategoriaDocumento.LEGAL], ahora)).toBe(
      true,
    );
    expect(esElegible(homologacion, [CategoriaDocumento.HSE], ahora)).toBe(
      false,
    );
  });
});
