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

/**
 * Award amount above which the contract needs a legal review before signing.
 * Roughly USD 50k in each currency — a single flat number meant almost every
 * COP or CLP purchase needed legal review, and almost no USD one did.
 */
export const UMBRAL_REVISION_LEGAL: Record<Moneda, number> = {
  USD: 50_000,
  COP: 200_000_000,
  MXN: 1_000_000,
  PEN: 190_000,
  CLP: 47_000_000,
  BRL: 280_000,
};

export function requiereRevisionLegal(monto: number, moneda: Moneda): boolean {
  return monto > UMBRAL_REVISION_LEGAL[moneda];
}
