export type ResultadoProceso =
  'ganado' | 'perdido' | 'seleccionado' | 'pendiente';

interface AdjudicacionResumen {
  proveedorId: string;
  precioFinal: number;
  confirmada: boolean;
  firmado: boolean;
}

/**
 * How a process ended for one proveedor that sent an offer. With a split
 * award it may win some lines (its own award is what counts); it only "lost"
 * once every award was signed without it. The competitive comparison is
 * only meaningful against a single whole-process award.
 */
export function resultadoProveedor<A extends AdjudicacionResumen>(
  adjudicaciones: A[],
  proveedorId: string,
): {
  resultado: ResultadoProceso;
  mia: A | undefined;
  parcial: boolean;
  precioComparable: number | null;
} {
  const mia = adjudicaciones.find((a) => a.proveedorId === proveedorId);
  const parcial = adjudicaciones.length > 1;
  let resultado: ResultadoProceso = 'pendiente';
  if (mia?.firmado) resultado = 'ganado';
  else if (mia?.confirmada) resultado = 'seleccionado';
  else if (
    !mia &&
    adjudicaciones.length > 0 &&
    adjudicaciones.every((a) => a.firmado)
  )
    resultado = 'perdido';
  return {
    resultado,
    mia,
    parcial,
    precioComparable: parcial ? null : (adjudicaciones[0]?.precioFinal ?? null),
  };
}
