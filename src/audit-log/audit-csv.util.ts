/** RFC 4180 field: quote when needed, double inner quotes, neutralize spreadsheet formulas. */
export function csvCampo(valor: string | null | undefined): string {
  let v = valor ?? '';
  // A cell starting with = + - @ is executed as a formula by Excel/Sheets
  // (CSV injection) — prefix it so it's shown as text.
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n\r;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export const CSV_ENCABEZADO = [
  'Fecha (UTC)',
  'Usuario',
  'Acción',
  'Detalle',
  'Motivo',
];

export function csvFila(e: {
  createdAt: Date;
  usuario: string;
  accion: string;
  detalle: string;
  motivo: string | null;
}) {
  return [e.createdAt.toISOString(), e.usuario, e.accion, e.detalle, e.motivo]
    .map(csvCampo)
    .join(',');
}

/** Retention can't go below one year — shorter would defeat the audit trail's purpose. */
export const RETENCION_MIN_MESES = 12;
export const RETENCION_MAX_MESES = 240;
export const RETENCION_DEFAULT_MESES = 120;

export function fechaCorte(meses: number, ahora = new Date()): Date {
  const d = new Date(ahora);
  d.setMonth(d.getMonth() - meses);
  return d;
}
