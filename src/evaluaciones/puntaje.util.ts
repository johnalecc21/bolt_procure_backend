/** Weights per criterion; they sum to 1. Quality and on-time delivery dominate. */
export const PESOS_CRITERIOS = {
  calidad: 0.35,
  plazos: 0.3,
  servicio: 0.2,
  hse: 0.15,
} as const;

/** Below this 0-100 score the proveedor is asked for an improvement plan. */
export const UMBRAL_PLAN_MEJORA = 60;

export type Criterios = Record<keyof typeof PESOS_CRITERIOS, number>;

/** Weighted average of 1-5 criteria, scaled to 0-100 (all 1s → 20, all 5s → 100). */
export function calcularPuntaje(c: Criterios): number {
  const ponderado = (
    Object.keys(PESOS_CRITERIOS) as (keyof Criterios)[]
  ).reduce((sum, k) => sum + PESOS_CRITERIOS[k] * c[k], 0);
  return Math.round((ponderado / 5) * 100);
}
