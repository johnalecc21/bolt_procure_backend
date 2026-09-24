/** Standard UTC offset of each supported country (none of them uses DST today except Chile's winter shift, which is ignored). */
const OFFSET_POR_PAIS: Record<string, string> = {
  CO: '-05:00',
  PE: '-05:00',
  EC: '-05:00',
  MX: '-06:00',
  CL: '-04:00',
  BR: '-03:00',
  US: '-05:00',
};

/**
 * A tender deadline picked as a calendar date ("2026-10-01") means "until the
 * end of that day where the company operates" — not midnight UTC, which in
 * Colombia would close it at 7 p.m. the day before. Full ISO timestamps are
 * kept as they are.
 */
export function finDelDia(fecha: string, pais = 'CO'): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return new Date(`${fecha}T23:59:59${OFFSET_POR_PAIS[pais] ?? '-05:00'}`);
  }
  return new Date(fecha);
}
