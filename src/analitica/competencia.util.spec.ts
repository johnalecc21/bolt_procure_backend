import { calcularCompetencia } from './competencia.util';

describe('calcularCompetencia', () => {
  const ofertas = [
    { proveedorId: 'a', precio: 100 },
    { proveedorId: 'b', precio: 120 },
    { proveedorId: 'c', precio: 90 },
  ];

  it('ordena por precio final y mide la brecha con lo adjudicado', () => {
    expect(calcularCompetencia(ofertas, [], 'b', 90)).toEqual({
      posicion: 3,
      participantes: 3,
      brechaPct: 30 / 90,
    });
  });

  it('usa la puja final cuando hubo negociación', () => {
    const pujas = [
      { proveedorId: 'b', precio: 85 },
      { proveedorId: 'c', precio: 88 },
    ];
    expect(calcularCompetencia(ofertas, pujas, 'b', 85)).toMatchObject({
      posicion: 1,
      brechaPct: 0,
    });
  });

  it('empates comparten la mejor posición y sin oferta no hay dato', () => {
    expect(
      calcularCompetencia(
        [
          { proveedorId: 'a', precio: 10 },
          { proveedorId: 'b', precio: 10 },
        ],
        [],
        'b',
        10,
      )?.posicion,
    ).toBe(1);
    expect(calcularCompetencia(ofertas, [], 'zz', 90)).toBeNull();
  });
});
