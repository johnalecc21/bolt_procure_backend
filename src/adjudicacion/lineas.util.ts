/** Money per line: quantities can be fractional, amounts are whole units. */
export function subtotalLinea(cantidad: number, precioUnitario: number) {
  return Math.round(cantidad * precioUnitario);
}

export interface LineaCalculada {
  itemId: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

/**
 * The awarded lines for one proveedor, priced from its offer. When it took
 * part in a negotiation round its final bid replaces its offer total, so each
 * line is scaled by bid / offer; if it wins every line it quoted, the award
 * is exactly the bid. Returns null when a line wasn't quoted by it.
 */
export function calcularLineas(
  items: { id: string; cantidad: number }[],
  precios: { itemId: string; precioUnitario: number }[],
  itemIds: string[],
  ofertaTotal: number,
  puja?: number,
): { precioFinal: number; lineas: LineaCalculada[] } | null {
  const precioDe = new Map(precios.map((p) => [p.itemId, p.precioUnitario]));
  const cantidadDe = new Map(items.map((i) => [i.id, i.cantidad]));
  const factor = puja != null && ofertaTotal > 0 ? puja / ofertaTotal : 1;
  const lineas: LineaCalculada[] = [];
  for (const itemId of itemIds) {
    const precio = precioDe.get(itemId);
    const cantidad = cantidadDe.get(itemId);
    if (precio == null || cantidad == null) return null;
    const precioUnitario = Math.round(precio * factor);
    lineas.push({
      itemId,
      cantidad,
      precioUnitario,
      subtotal: subtotalLinea(cantidad, precioUnitario),
    });
  }
  const todo = precios.every((p) => itemIds.includes(p.itemId));
  const precioFinal =
    puja != null && todo ? puja : lineas.reduce((s, l) => s + l.subtotal, 0);
  return { precioFinal, lineas };
}
