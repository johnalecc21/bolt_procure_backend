import { PlanCliente } from '@prisma/client';

/** null = unlimited. */
export interface LimitesPlan {
  usuarios: number | null;
  requerimientosMes: number | null;
  almacenamientoMb: number | null;
}

export const LIMITES_PLAN: Record<PlanCliente, LimitesPlan> = {
  STARTER: { usuarios: 5, requerimientosMes: 15, almacenamientoMb: 1024 },
  GROWTH: { usuarios: 25, requerimientosMes: 150, almacenamientoMb: 10 * 1024 },
  ENTERPRISE: {
    usuarios: null,
    requerimientosMes: null,
    almacenamientoMb: null,
  },
};

export const NOMBRE_PLAN: Record<PlanCliente, string> = {
  STARTER: 'Starter',
  GROWTH: 'Growth',
  ENTERPRISE: 'Enterprise',
};

export const BYTES_POR_MB = 1024 * 1024;

/** True when adding `incremento` to `usado` stays within `limite`. */
export function dentroDelLimite(
  limite: number | null,
  usado: number,
  incremento = 1,
): boolean {
  return limite === null || usado + incremento <= limite;
}

export function inicioDeMes(fecha = new Date()): Date {
  return new Date(fecha.getFullYear(), fecha.getMonth(), 1);
}
