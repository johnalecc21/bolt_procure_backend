import { ResultadoLista } from '@prisma/client';
import {
  esColombia,
  ListasRestrictivasService,
} from './listas-restrictivas.service';
import type { OfacService } from './ofac.service';
import type { OnuService } from './onu.service';
import type { NameMatch } from './name-matching';

function servicio(
  ofac: (n: string) => NameMatch | null,
  onu: (n: string) => NameMatch | null,
) {
  return new ListasRestrictivasService(
    {
      checkName: jest.fn((n: string) => Promise.resolve(ofac(n))),
    } as unknown as OfacService,
    {
      checkName: jest.fn((n: string) => Promise.resolve(onu(n))),
    } as unknown as OnuService,
  );
}

describe('ListasRestrictivasService', () => {
  it('reports clean results when no list matches', async () => {
    const res = await servicio(
      () => ({ matched: false }),
      () => ({ matched: false }),
    ).verificar(['Acme'], 'México');
    expect(res).toEqual([
      {
        lista: 'OFAC',
        resultado: ResultadoLista.SIN_COINCIDENCIA,
        detalle: null,
      },
      {
        lista: 'ONU',
        resultado: ResultadoLista.SIN_COINCIDENCIA,
        detalle: null,
      },
    ]);
  });

  it('flags a hit on the legal representative, not only the company', async () => {
    const res = await servicio(
      (n) =>
        n === 'Juan Pérez'
          ? { matched: true, matchedName: 'JUAN PEREZ', similarity: 0.97 }
          : { matched: false },
      () => ({ matched: false }),
    ).verificar(['Acme', 'Juan Pérez'], null);
    expect(res[0].resultado).toBe(ResultadoLista.COINCIDENCIA);
    expect(res[0].detalle).toContain('Juan Pérez');
  });

  it('marks an unreachable list as NO_DISPONIBLE instead of clean', async () => {
    const res = await servicio(
      () => null,
      () => ({ matched: false }),
    ).verificar(['Acme'], null);
    expect(res[0].resultado).toBe(ResultadoLista.NO_DISPONIBLE);
  });

  it('adds the Colombian manual lists for Colombian proveedores', async () => {
    const res = await servicio(
      () => ({ matched: false }),
      () => ({ matched: false }),
    ).verificar(['Acme'], 'Colombia');
    expect(
      res
        .filter((r) => r.resultado === ResultadoLista.PENDIENTE_MANUAL)
        .map((r) => r.lista),
    ).toEqual(['PROCURADURIA', 'CONTRALORIA', 'POLICIA']);
  });

  it('recognizes Colombia by name or ISO code', () => {
    expect(esColombia('Bogotá, Colombia')).toBe(true);
    expect(esColombia('CO')).toBe(true);
    expect(esColombia('Perú')).toBe(false);
    expect(esColombia(null)).toBe(false);
  });
});
