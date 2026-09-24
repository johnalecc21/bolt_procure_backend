import { EstadoContrato, EstadoHito, TipoContrato } from '@prisma/client';

const MS_DIA = 86_400_000;

/** States in which a contract can still be executed, extended or amended. */
export const ESTADOS_OPERATIVOS: EstadoContrato[] = [
  EstadoContrato.ACTIVO,
  EstadoContrato.POR_VENCER,
  EstadoContrato.EN_RENOVACION,
];

/**
 * A Contrato Marco is a ceiling agreement: it isn't paid by itself — the
 * purchase orders issued against it are, each with its own milestones.
 */
export function esMarco(c: {
  tipo: TipoContrato;
  contratoPadreId: string | null;
}) {
  return c.tipo === TipoContrato.CONTRATO && !c.contratoPadreId;
}

/** Ceiling left on a marco: its amount minus the POs issued (terminated ones included — they were committed). */
export function saldoMarco(monto: number, hijas: { monto: number }[]) {
  return monto - hijas.reduce((s, h) => s + h.monto, 0);
}

/** State that follows from the validity dates alone. */
export function estadoPorVigencia(
  vigenciaFin: Date,
  ahora = new Date(),
): EstadoContrato {
  const dias = Math.ceil((vigenciaFin.getTime() - ahora.getTime()) / MS_DIA);
  if (dias < 0) return EstadoContrato.VENCIDO;
  if (dias <= 30) return EstadoContrato.POR_VENCER;
  return EstadoContrato.ACTIVO;
}

export const DIAS_EN_RIESGO = 3;

/**
 * A milestone past its committed day is late; one due within three days is at
 * risk. Completed ones never change, and a manual "en riesgo" isn't undone.
 */
export function estadoHitoAutomatico(
  h: { estado: EstadoHito; comprometido: Date },
  ahora = new Date(),
): EstadoHito {
  if (h.estado === EstadoHito.COMPLETADO) return h.estado;
  const finDelDiaComprometido = h.comprometido.getTime() + MS_DIA;
  if (finDelDiaComprometido < ahora.getTime()) return EstadoHito.ATRASADO;
  if (
    h.estado === EstadoHito.PENDIENTE &&
    h.comprometido.getTime() - ahora.getTime() <= DIAS_EN_RIESGO * MS_DIA
  )
    return EstadoHito.EN_RIESGO;
  return h.estado;
}

/** Payment milestones can't promise more than the whole contract. */
export function porcentajeAsignado(
  hitos: { id: string; porcentaje: number }[],
  excepto?: string,
) {
  return hitos
    .filter((h) => h.id !== excepto)
    .reduce((s, h) => s + h.porcentaje, 0);
}
