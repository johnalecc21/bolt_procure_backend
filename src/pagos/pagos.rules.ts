import { EstadoPago } from '@prisma/client';

export const FACTURAS_BUCKET = 'facturas-pagos';
export const MAX_BYTES_FACTURA = 10 * 1024 * 1024;
export const MIME_FACTURA = [
  'application/pdf',
  'application/xml',
  'text/xml',
  'image/jpeg',
  'image/png',
];

/** Overdue is a fact of the date — shown right away, persisted by the daily cron. */
export function estadoEfectivo(
  estado: EstadoPago,
  fechaPagoPactada: Date,
  ahora = new Date(),
): EstadoPago {
  return estado === EstadoPago.PENDIENTE && fechaPagoPactada < ahora
    ? EstadoPago.VENCIDO
    : estado;
}

/** When the payment term starts counting: the day the invoice is filed. */
export function fechaPactadaDesde(
  radicacion: Date,
  condicionesPagoDias: number,
) {
  const f = new Date(radicacion);
  f.setDate(f.getDate() + condicionesPagoDias);
  return f;
}
