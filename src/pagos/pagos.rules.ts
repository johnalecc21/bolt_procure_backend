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

/** Monthly rate offered for paying early (1.5% per 30 days brought forward). */
export const TASA_DESCUENTO_MENSUAL = 0.015;
const MS_DIA = 86_400_000;

/**
 * Discount for paying on `propuesta` instead of the agreed date. Days are
 * whole calendar days between the two, pro-rated at the monthly rate.
 */
export function calcularProntoPago(
  monto: number,
  pactada: Date,
  propuesta: Date,
) {
  const dias = Math.max(
    0,
    Math.round((pactada.getTime() - propuesta.getTime()) / MS_DIA),
  );
  const descuentoPct = (TASA_DESCUENTO_MENSUAL * dias) / 30;
  const montoNeto = Math.round(monto * (1 - descuentoPct));
  return { dias, descuentoPct, montoNeto, descuento: monto - montoNeto };
}

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
