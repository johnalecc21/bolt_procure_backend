import { Moneda } from '@prisma/client';

/** Locale that formats each currency the way its own market writes it. */
const LOCALE: Record<Moneda, string> = {
  COP: 'es-CO',
  USD: 'en-US',
  MXN: 'es-MX',
  PEN: 'es-PE',
  CLP: 'es-CL',
  BRL: 'pt-BR',
};

/** Amounts are stored as whole units, so no minor-unit digits are shown. */
export function formatMonto(
  monto: number,
  moneda: Moneda = Moneda.USD,
): string {
  const formatted = new Intl.NumberFormat(LOCALE[moneda], {
    style: 'currency',
    currency: moneda,
    maximumFractionDigits: 0,
  }).format(monto);
  // Several currencies share the bare "$" symbol — the code disambiguates.
  return moneda === Moneda.BRL ? formatted : `${formatted} ${moneda}`;
}
