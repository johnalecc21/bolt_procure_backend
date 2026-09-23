import { dentroDelLimite, inicioDeMes, LIMITES_PLAN } from './planes.constants';

describe('plan limits', () => {
  it('treats null as unlimited', () => {
    expect(dentroDelLimite(null, 10_000)).toBe(true);
  });

  it('allows reaching the limit exactly, not exceeding it', () => {
    expect(dentroDelLimite(5, 4)).toBe(true);
    expect(dentroDelLimite(5, 5)).toBe(false);
    expect(dentroDelLimite(100, 60, 40)).toBe(true);
    expect(dentroDelLimite(100, 60, 41)).toBe(false);
  });

  it('grows with the plan and Enterprise is unlimited', () => {
    expect(LIMITES_PLAN.GROWTH.usuarios!).toBeGreaterThan(
      LIMITES_PLAN.STARTER.usuarios!,
    );
    expect(LIMITES_PLAN.ENTERPRISE).toEqual({
      usuarios: null,
      requerimientosMes: null,
      almacenamientoMb: null,
    });
  });

  it('counts requerimientos from the first day of the month', () => {
    expect(inicioDeMes(new Date(2026, 8, 23, 15))).toEqual(
      new Date(2026, 8, 1),
    );
  });
});
