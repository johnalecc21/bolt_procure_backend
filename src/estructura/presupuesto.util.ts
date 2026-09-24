import { EstadoRequerimiento } from '@prisma/client';

/** Requerimientos still competing for budget: approved or pending, but not yet turned into a contract. */
export const ESTADOS_EN_PROCESO: EstadoRequerimiento[] = [
  EstadoRequerimiento.PENDIENTE_APROBACION,
  EstadoRequerimiento.EN_LICITACION,
  EstadoRequerimiento.EN_NEGOCIACION,
  // Awarded but not signed yet: the contract (and its commitment) doesn't exist until firmar().
  EstadoRequerimiento.ADJUDICADO,
];

export interface Ejecucion {
  presupuesto: number;
  comprometido: number;
  enProceso: number;
  disponible: number;
  /** 0-100+, share of the budget already committed or in process. */
  porcentajeUsado: number;
}

export function calcularEjecucion(
  presupuesto: number,
  comprometido: number,
  enProceso: number,
): Ejecucion {
  const usado = comprometido + enProceso;
  return {
    presupuesto,
    comprometido,
    enProceso,
    disponible: presupuesto - usado,
    porcentajeUsado:
      presupuesto > 0 ? Math.round((usado / presupuesto) * 100) : 0,
  };
}

export function rangoAnio(anio: number): { gte: Date; lt: Date } {
  return { gte: new Date(anio, 0, 1), lt: new Date(anio + 1, 0, 1) };
}
