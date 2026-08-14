/** "Acme Corp" -> "AC". Falls back to `fallback` when the name has no usable words. */
export function iniciales(nombre: string, fallback = '??'): string {
  return (
    nombre
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || fallback
  );
}
