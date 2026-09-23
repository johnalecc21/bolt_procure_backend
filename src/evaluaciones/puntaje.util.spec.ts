import {
  calcularPuntaje,
  PESOS_CRITERIOS,
  UMBRAL_PLAN_MEJORA,
} from './puntaje.util';

describe('calcularPuntaje', () => {
  it('weights sum to 1', () => {
    const total = Object.values(PESOS_CRITERIOS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1);
  });

  it('maps all-5 to 100 and all-1 to 20', () => {
    expect(
      calcularPuntaje({ calidad: 5, plazos: 5, servicio: 5, hse: 5 }),
    ).toBe(100);
    expect(
      calcularPuntaje({ calidad: 1, plazos: 1, servicio: 1, hse: 1 }),
    ).toBe(20);
  });

  it('weights quality above HSE', () => {
    const altaCalidad = calcularPuntaje({
      calidad: 5,
      plazos: 3,
      servicio: 3,
      hse: 1,
    });
    const altoHse = calcularPuntaje({
      calidad: 1,
      plazos: 3,
      servicio: 3,
      hse: 5,
    });
    expect(altaCalidad).toBeGreaterThan(altoHse);
  });

  it('flags mostly-2 evaluations for an improvement plan', () => {
    expect(
      calcularPuntaje({ calidad: 2, plazos: 2, servicio: 3, hse: 3 }),
    ).toBeLessThan(UMBRAL_PLAN_MEJORA);
  });
});
