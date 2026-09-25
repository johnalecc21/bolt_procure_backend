import { EstadoPago } from '@prisma/client';
import { estadoEfectivo, fechaPactadaDesde } from './pagos.rules';

describe('reglas de pagos', () => {
  it('shows overdue payments as VENCIDO without waiting for the cron', () => {
    const ayer = new Date(Date.now() - 86_400_000);
    expect(estadoEfectivo(EstadoPago.PENDIENTE, ayer)).toBe(EstadoPago.VENCIDO);
    expect(estadoEfectivo(EstadoPago.PAGADO, ayer)).toBe(EstadoPago.PAGADO);
  });

  it('starts the payment term on the filing date', () => {
    expect(fechaPactadaDesde(new Date(2026, 0, 10), 30)).toEqual(
      new Date(2026, 1, 9),
    );
  });
});
