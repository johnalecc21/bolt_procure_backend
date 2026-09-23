import { calcularEjecucion, rangoAnio } from './presupuesto.util';

describe('calcularEjecucion', () => {
  it('subtracts committed and in-process amounts from the budget', () => {
    expect(calcularEjecucion(1000, 400, 100)).toEqual({
      presupuesto: 1000,
      comprometido: 400,
      enProceso: 100,
      disponible: 500,
      porcentajeUsado: 50,
    });
  });

  it('goes negative (over 100%) when overspent', () => {
    const e = calcularEjecucion(1000, 900, 300);
    expect(e.disponible).toBe(-200);
    expect(e.porcentajeUsado).toBe(120);
  });

  it('handles a zero budget without dividing by zero', () => {
    expect(calcularEjecucion(0, 0, 0).porcentajeUsado).toBe(0);
  });

  it('covers the whole calendar year', () => {
    expect(rangoAnio(2026)).toEqual({
      gte: new Date(2026, 0, 1),
      lt: new Date(2027, 0, 1),
    });
  });
});
