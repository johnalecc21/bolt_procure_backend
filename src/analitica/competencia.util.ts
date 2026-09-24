export interface PrecioProveedor {
  proveedorId: string;
  precio: number;
}

export interface Competencia {
  /** 1 = lowest final price. Ties share the better rank. */
  posicion: number;
  participantes: number;
  /** (my final price − awarded price) / awarded price. */
  brechaPct: number;
}

/**
 * Where a supplier's final price landed among the offers of one process:
 * its bid after a negotiation round when there was one, its sent offer
 * otherwise. Only the rank, the count and the gap to the awarded price leave
 * the server — never the winner's identity or anyone else's amount.
 */
export function calcularCompetencia(
  ofertas: PrecioProveedor[],
  pujas: PrecioProveedor[],
  proveedorId: string,
  precioAdjudicado: number,
): Competencia | null {
  const finalPorProveedor = new Map(
    ofertas.map((o) => [o.proveedorId, o.precio]),
  );
  for (const p of pujas)
    if (finalPorProveedor.has(p.proveedorId))
      finalPorProveedor.set(p.proveedorId, p.precio);
  const mio = finalPorProveedor.get(proveedorId);
  if (mio == null || precioAdjudicado <= 0) return null;
  const precios = [...finalPorProveedor.values()];
  return {
    posicion: 1 + precios.filter((x) => x < mio).length,
    participantes: precios.length,
    brechaPct: (mio - precioAdjudicado) / precioAdjudicado,
  };
}
